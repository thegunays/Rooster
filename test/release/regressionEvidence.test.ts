import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  afterEach,
  describe,
  expect,
  it
} from "vitest";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, parse, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

interface EvidenceFailure {
  readonly code: string;
  readonly field: string;
  readonly message: string;
}

interface RegressionEvidenceModule {
  readonly MAX_FAILURES: number;
  validateRegressionEvidence(
    evidence: unknown,
    options: {
      readonly evidenceDirectory: string;
      readonly requireAzureHost?: boolean;
    }
  ): readonly EvidenceFailure[];
}

interface EvidenceFixture {
  readonly root: string;
  readonly evidencePath: string;
  readonly evidence: Record<string, unknown>;
}

const repositoryRoot = process.cwd();
const validatorPath = join(repositoryRoot, "scripts/lib/regression-evidence.mjs");
const verifierPath = join(repositoryRoot, "scripts/verify-regression-evidence.mjs");
const temporaryRoots: string[] = [];

const customRaw =
  "<style>table{border:1px solid black}.heading{color:#253342}</style>" +
  '<section><h1 class="heading">BKU</h1>' +
  '<table id="one"></table><table id="two"></table><table id="three"></table>' +
  '<table id="four"></table><table id="five"></table><table id="six"></table></section>';

const canonicalRaw =
  "<style>" +
  "[data-rdx-content-root] table,[data-rdx-content-root] .heading{border:1px solid black;color:#253342}" +
  "@media print{[data-rdx-content-root]>table{width:100%!important}}" +
  "</style>" +
  '<div data-rdx-content-root=""><h1 class="heading">BKU</h1>' +
  '<table id="one"></table><table id="two"></table><table id="three"></table>' +
  '<table id="four"></table><table id="five"></table><table id="six"></table></div>';

const regressionEvidence = await import(
  pathToFileURL(validatorPath).href
) as unknown as RegressionEvidenceModule;

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function createRoot(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "rooster-regression-evidence-")));
  temporaryRoots.push(root);
  return root;
}

function writeRelative(root: string, relativePath: string, value: string | Buffer): void {
  const filePath = join(root, ...relativePath.split("/"));
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, value);
}

function createCommonEvidence(root: string, scenario: string): Record<string, unknown> {
  writeRelative(root, "screenshots/before.png", Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  writeRelative(root, "screenshots/after.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d]));

  return {
    extensionVersion: "0.1.21",
    evidenceKind: "local-dry-run",
    scenario,
    beforeRawPath: "raw/before.html",
    beforeRawSha256: sha256(scenario === "custom-field" ? customRaw : canonicalRaw),
    beforeTableCount: 6,
    afterTableCount: 6,
    headingStyleMatch: true,
    borderStyleMatch: true,
    colorStyleMatch: true,
    domStructureMatch: true,
    descriptionWriteCount: scenario === "custom-field" ? 0 : 1,
    targetWriteCount: 1,
    consoleErrors: [],
    beforeScreenshot: "screenshots/before.png",
    afterScreenshot: "screenshots/after.png"
  };
}

function createCustomFixture(): EvidenceFixture {
  const root = createRoot();
  writeRelative(root, "raw/before.html", customRaw);
  writeRelative(root, "raw/after.html", customRaw);
  const evidence = {
    ...createCommonEvidence(root, "custom-field"),
    afterRawPath: "raw/after.html",
    afterRawSha256: sha256(customRaw)
  };
  const evidencePath = join(root, "evidence.json");
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  return { root, evidencePath, evidence };
}

function createExplicitFixture(): EvidenceFixture {
  const root = createRoot();
  writeRelative(root, "raw/before.html", canonicalRaw);
  writeRelative(root, "raw/after-save.html", canonicalRaw);
  writeRelative(root, "raw/after-refresh.html", canonicalRaw);
  writeRelative(root, "raw/after-reopen.html", canonicalRaw);
  const evidence = {
    ...createCommonEvidence(root, "explicit-system-description"),
    afterSaveRawPath: "raw/after-save.html",
    afterRefreshRawPath: "raw/after-refresh.html",
    afterReopenRawPath: "raw/after-reopen.html",
    afterSaveRawSha256: sha256(canonicalRaw),
    afterRefreshRawSha256: sha256(canonicalRaw),
    afterReopenRawSha256: sha256(canonicalRaw),
    canonicalRootAfterSave: true,
    canonicalRootAfterReopen: true,
    allStyleSelectorsScoped: true
  };
  const evidencePath = join(root, "evidence.json");
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  return { root, evidencePath, evidence };
}

function validate(
  fixture: EvidenceFixture,
  requireAzureHost = false
): readonly EvidenceFailure[] {
  return regressionEvidence.validateRegressionEvidence(fixture.evidence, {
    evidenceDirectory: fixture.root,
    requireAzureHost
  });
}

function codes(failures: readonly EvidenceFailure[]): string[] {
  return failures.map(failure => failure.code);
}

function fields(failures: readonly EvidenceFailure[]): string[] {
  return failures.map(failure => failure.field);
}

function replaceExplicitCaptures(fixture: EvidenceFixture, value: string): void {
  const hash = sha256(value);
  for (const [pathField, hashField] of [
    ["afterSaveRawPath", "afterSaveRawSha256"],
    ["afterRefreshRawPath", "afterRefreshRawSha256"],
    ["afterReopenRawPath", "afterReopenRawSha256"]
  ] as const) {
    writeRelative(fixture.root, fixture.evidence[pathField] as string, value);
    fixture.evidence[hashField] = hash;
  }
}

function explicitRawWithStylesheetPrefix(prefix: string): string {
  return canonicalRaw.replace("<style>", `<style>${prefix}`);
}

function referenceFromFilesystemRoot(root: string, relativePath: string): string {
  const absolutePath = join(root, ...relativePath.split("/"));
  return relative(parse(absolutePath).root, absolutePath).split(sep).join("/");
}

function persistEvidence(fixture: EvidenceFixture): void {
  writeFileSync(fixture.evidencePath, JSON.stringify(fixture.evidence, null, 2));
}

function runVerifier(
  fixture: EvidenceFixture,
  extraArguments: readonly string[] = [],
  evidencePath = fixture.evidencePath
) {
  return spawnSync(
    process.execPath,
    [verifierPath, ...extraArguments, evidencePath],
    {
      cwd: dirname(fixture.root),
      encoding: "utf8"
    }
  );
}

afterEach(() => {
  while (temporaryRoots.length > 0) {
    rmSync(temporaryRoots.pop()!, { recursive: true, force: true });
  }
});

describe("regression evidence shared contract", () => {
  it.each([
    ["custom-field", createCustomFixture],
    ["explicit-system-description", createExplicitFixture]
  ])("accepts complete literal %s evidence", (_scenario, createFixture) => {
    expect(validate(createFixture())).toEqual([]);
  });

  it("returns an ordered, bounded, content-safe structured failure list", () => {
    const evidence = {
      extensionVersion: "SECRET_VERSION",
      evidenceKind: "SECRET_KIND",
      scenario: "SECRET_SCENARIO",
      beforeRawPath: "SECRET_RAW_PATH",
      unexpectedSecret: "SECRET_CONTENT"
    };
    const options = { evidenceDirectory: createRoot() };

    const first = regressionEvidence.validateRegressionEvidence(evidence, options);
    const second = regressionEvidence.validateRegressionEvidence(evidence, options);

    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(0);
    expect(first.length).toBeLessThanOrEqual(regressionEvidence.MAX_FAILURES);
    expect(first.every(failure => failure.message.length <= 160)).toBe(true);
    expect(first.every(failure => /^[A-Z0-9_]+$/.test(failure.code))).toBe(true);
    expect(JSON.stringify(first)).not.toContain("SECRET");
  });

  it.each([
    ["extensionVersion", "0.1.20", "INVALID_EXTENSION_VERSION"],
    ["evidenceKind", "synthetic", "INVALID_EVIDENCE_KIND"],
    ["scenario", "description", "INVALID_SCENARIO"],
    ["beforeRawPath", 42, "INVALID_FIELD"],
    ["beforeRawSha256", "not-a-sha", "INVALID_SHA256"],
    ["beforeTableCount", 5, "INVALID_TABLE_COUNT"],
    ["beforeTableCount", 6.5, "INVALID_TABLE_COUNT"],
    ["afterTableCount", 7, "INVALID_TABLE_COUNT"],
    ["headingStyleMatch", false, "VISUAL_MISMATCH"],
    ["borderStyleMatch", false, "VISUAL_MISMATCH"],
    ["colorStyleMatch", false, "VISUAL_MISMATCH"],
    ["domStructureMatch", false, "VISUAL_MISMATCH"],
    ["descriptionWriteCount", -1, "INVALID_WRITE_COUNT"],
    ["targetWriteCount", 0, "TARGET_WRITE_REQUIRED"],
    ["targetWriteCount", 1.5, "INVALID_WRITE_COUNT"],
    ["consoleErrors", ["browser failed"], "CONSOLE_ERRORS_PRESENT"],
    ["consoleErrors", [1], "INVALID_CONSOLE_ERRORS"],
    ["beforeScreenshot", false, "INVALID_FIELD"],
    ["afterScreenshot", "", "INVALID_FIELD"]
  ])("rejects invalid shared field %s", (field, value, expectedCode) => {
    const fixture = createCustomFixture();
    fixture.evidence[field] = value;

    expect(codes(validate(fixture))).toContain(expectedCode);
    expect(fields(validate(fixture))).toContain(field);
  });

  it("rejects unknown fields instead of silently widening the evidence schema", () => {
    const fixture = createCustomFixture();
    fixture.evidence.unexpected = true;

    expect(codes(validate(fixture))).toEqual(["UNKNOWN_FIELD"]);
  });

  it("rejects local evidence when the Azure-host gate is required", () => {
    const fixture = createCustomFixture();

    expect(codes(validate(fixture, true))).toEqual(["AZURE_HOST_REQUIRED"]);
  });

  it("accepts valid Azure-host evidence when the Azure-host gate is required", () => {
    const fixture = createCustomFixture();
    fixture.evidence.evidenceKind = "azure-host";

    expect(validate(fixture, true)).toEqual([]);
  });

  it.each(["beforeScreenshot", "afterScreenshot"])(
    "requires the %s path to exist as a regular file",
    field => {
      const fixture = createCustomFixture();
      fixture.evidence[field] = "screenshots/missing.png";

      expect(codes(validate(fixture))).toEqual(["FILE_MISSING"]);
      expect(fields(validate(fixture))).toEqual([field]);
    }
  );

  it("review regression: opens screenshots so unreadable bytes cannot pass", () => {
    const fixture = createCustomFixture();
    const screenshot = join(fixture.root, fixture.evidence.beforeScreenshot as string);
    chmodSync(screenshot, 0o000);

    const failures = validate(fixture);
    chmodSync(screenshot, 0o600);

    expect(codes(failures)).toEqual(["FILE_UNREADABLE"]);
    expect(fields(failures)).toEqual(["beforeScreenshot"]);
  });

  it("requires a referenced capture to be a regular file", () => {
    const fixture = createCustomFixture();
    mkdirSync(join(fixture.root, "raw", "directory.html"));
    fixture.evidence.beforeRawPath = "raw/directory.html";

    expect(codes(validate(fixture))).toEqual(["FILE_NOT_REGULAR"]);
  });

  it.each([
    ["absolute", "/tmp/outside.html"],
    ["parent traversal", "../outside.html"],
    ["dot segment", "raw/../raw/before.html"],
    ["backslash ambiguity", "raw\\before.html"]
  ])("rejects an %s evidence path", (_label, path) => {
    const fixture = createCustomFixture();
    fixture.evidence.beforeRawPath = path;

    expect(codes(validate(fixture))).toEqual(["INVALID_PATH"]);
  });

  it("does not follow a raw-capture symlink", () => {
    const fixture = createCustomFixture();
    writeRelative(fixture.root, "outside.html", customRaw);
    symlinkSync(join(fixture.root, "outside.html"), join(fixture.root, "raw", "link.html"));
    fixture.evidence.beforeRawPath = "raw/link.html";

    expect(codes(validate(fixture))).toEqual(["SYMLINK_FORBIDDEN"]);
  });

  it("does not follow a symlinked path component", () => {
    const fixture = createCustomFixture();
    mkdirSync(join(fixture.root, "external"));
    writeRelative(fixture.root, "external/before.html", customRaw);
    symlinkSync(join(fixture.root, "external"), join(fixture.root, "linked-raw"));
    fixture.evidence.beforeRawPath = "linked-raw/before.html";

    expect(codes(validate(fixture))).toEqual(["SYMLINK_FORBIDDEN"]);
  });

  it("review regression: rejects a symlinked evidence directory itself", () => {
    const fixture = createCustomFixture();
    const aliasParent = createRoot();
    const aliasRoot = join(aliasParent, "evidence-alias");
    symlinkSync(fixture.root, aliasRoot, "dir");

    const failures = regressionEvidence.validateRegressionEvidence(fixture.evidence, {
      evidenceDirectory: aliasRoot
    });

    expect(codes(failures)).toEqual(["SYMLINK_FORBIDDEN"]);
    expect(fields(failures)).toEqual(["$"]);
  });

  it("resolves every relative reference from the evidence directory", () => {
    const fixture = createCustomFixture();
    const unrelatedDirectory = createRoot();
    const originalCwd = process.cwd();

    process.chdir(unrelatedDirectory);
    try {
      expect(validate(fixture)).toEqual([]);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("review regression: accepts normalized references beneath the filesystem root", () => {
    const fixture = createExplicitFixture();
    for (const field of [
      "beforeRawPath",
      "beforeScreenshot",
      "afterScreenshot",
      "afterSaveRawPath",
      "afterRefreshRawPath",
      "afterReopenRawPath"
    ]) {
      fixture.evidence[field] = referenceFromFilesystemRoot(
        fixture.root,
        fixture.evidence[field] as string
      );
    }

    const failures = regressionEvidence.validateRegressionEvidence(fixture.evidence, {
      evidenceDirectory: parse(fixture.root).root
    });

    expect(failures).toEqual([]);
  });

  it("recomputes the before-capture hash instead of trusting its declaration", () => {
    const fixture = createCustomFixture();
    fixture.evidence.beforeRawSha256 = "0".repeat(64);

    expect(codes(validate(fixture))).toEqual(["HASH_MISMATCH"]);
    expect(fields(validate(fixture))).toEqual(["beforeRawSha256"]);
  });

  it("checks the actual table count in the raw captures", () => {
    const fixture = createCustomFixture();
    const fiveTables = customRaw.replace('<table id="six"></table>', "");
    writeRelative(fixture.root, "raw/before.html", fiveTables);
    writeRelative(fixture.root, "raw/after.html", fiveTables);
    fixture.evidence.beforeRawSha256 = sha256(fiveTables);
    fixture.evidence.afterRawSha256 = sha256(fiveTables);

    expect(codes(validate(fixture))).toEqual([
      "RAW_TABLE_COUNT_MISMATCH",
      "RAW_TABLE_COUNT_MISMATCH"
    ]);
  });
});

describe("custom-field regression evidence", () => {
  it("requires every custom-field-only property", () => {
    const fixture = createCustomFixture();
    delete fixture.evidence.afterRawPath;

    expect(codes(validate(fixture))).toEqual(["INVALID_FIELD"]);
    expect(fields(validate(fixture))).toEqual(["afterRawPath"]);
  });

  it("rejects explicit-description-only fields on custom evidence", () => {
    const fixture = createCustomFixture();
    fixture.evidence.canonicalRootAfterSave = true;

    expect(codes(validate(fixture))).toEqual(["UNKNOWN_FIELD"]);
  });

  it("requires an exact after-capture hash", () => {
    const fixture = createCustomFixture();
    fixture.evidence.afterRawSha256 = "f".repeat(64);

    expect(codes(validate(fixture))).toEqual(["HASH_MISMATCH"]);
    expect(fields(validate(fixture))).toEqual(["afterRawSha256"]);
  });

  it("rejects changed raw bytes even when each submitted hash matches its file", () => {
    const fixture = createCustomFixture();
    const semanticallySimilar = customRaw.replace(">BKU<", "> BKU <");
    writeRelative(fixture.root, "raw/after.html", semanticallySimilar);
    fixture.evidence.afterRawSha256 = sha256(semanticallySimilar);

    expect(codes(validate(fixture))).toEqual(["RAW_BYTES_CHANGED"]);
  });

  it("requires zero System.Description writes", () => {
    const fixture = createCustomFixture();
    fixture.evidence.descriptionWriteCount = 1;

    expect(codes(validate(fixture))).toEqual(["DESCRIPTION_WRITE_FORBIDDEN"]);
  });
});

describe("explicit-System.Description regression evidence", () => {
  it.each([
    "afterSaveRawPath",
    "afterRefreshRawPath",
    "afterReopenRawPath"
  ])("requires explicit capture field %s", field => {
    const fixture = createExplicitFixture();
    delete fixture.evidence[field];

    expect(codes(validate(fixture))).toContain("INVALID_FIELD");
    expect(fields(validate(fixture))).toContain(field);
  });

  it.each([
    "afterSaveRawSha256",
    "afterRefreshRawSha256",
    "afterReopenRawSha256"
  ])("recomputes explicit capture hash %s", field => {
    const fixture = createExplicitFixture();
    fixture.evidence[field] = "0".repeat(64);

    expect(codes(validate(fixture))).toEqual(["HASH_MISMATCH"]);
    expect(fields(validate(fixture))).toEqual([field]);
  });

  it.each([
    ["afterRefreshRawPath", "afterRefreshRawSha256"],
    ["afterReopenRawPath", "afterReopenRawSha256"]
  ])("rejects byte drift in %s even with a matching declared hash", (pathField, hashField) => {
    const fixture = createExplicitFixture();
    const drifted = canonicalRaw.replace(">BKU<", ">BKU changed<");
    writeRelative(fixture.root, fixture.evidence[pathField] as string, drifted);
    fixture.evidence[hashField] = sha256(drifted);

    expect(codes(validate(fixture))).toContain("CANONICAL_BYTES_DRIFTED");
  });

  it("requires an explicit System.Description write", () => {
    const fixture = createExplicitFixture();
    fixture.evidence.descriptionWriteCount = 0;

    expect(codes(validate(fixture))).toEqual(["DESCRIPTION_WRITE_REQUIRED"]);
  });

  it.each([
    "canonicalRootAfterSave",
    "canonicalRootAfterReopen",
    "allStyleSelectorsScoped"
  ])("requires declared explicit evidence flag %s to be true", field => {
    const fixture = createExplicitFixture();
    fixture.evidence[field] = false;

    expect(codes(validate(fixture))).toEqual(["DECLARED_CHECK_FAILED"]);
    expect(fields(validate(fixture))).toEqual([field]);
  });

  it.each([
    ["saved", "afterSaveRawPath"],
    ["reopened", "afterReopenRawPath"]
  ])("independently rejects a missing canonical root in the %s capture", (_label, pathField) => {
    const fixture = createExplicitFixture();
    const withoutRoot = canonicalRaw
      .replace('<div data-rdx-content-root="">', "<div>")
      .replace("</div>", "</div>");
    writeRelative(fixture.root, fixture.evidence[pathField] as string, withoutRoot);
    const hashField = pathField.replace("Path", "Sha256");
    fixture.evidence[hashField] = sha256(withoutRoot);

    expect(codes(validate(fixture))).toContain("CANONICAL_ROOT_INVALID");
  });

  it.each([
    ["saved", "afterSaveRawPath"],
    ["reopened", "afterReopenRawPath"]
  ])("independently rejects a value-bearing root in the %s capture", (_label, pathField) => {
    const fixture = createExplicitFixture();
    const valuedRoot = canonicalRaw.replace(
      'data-rdx-content-root=""',
      'data-rdx-content-root="attacker"'
    );
    writeRelative(fixture.root, fixture.evidence[pathField] as string, valuedRoot);
    const hashField = pathField.replace("Path", "Sha256");
    fixture.evidence[hashField] = sha256(valuedRoot);

    expect(codes(validate(fixture))).toContain("CANONICAL_ROOT_INVALID");
  });

  it.each([
    ["saved", "afterSaveRawPath"],
    ["reopened", "afterReopenRawPath"]
  ])("independently rejects nested or additional roots in the %s capture", (_label, pathField) => {
    const fixture = createExplicitFixture();
    const nestedRoot = canonicalRaw.replace(
      '<h1 class="heading">',
      '<section data-rdx-content-root=""><h1 class="heading">'
    ).replace("</h1>", "</h1></section>");
    writeRelative(fixture.root, fixture.evidence[pathField] as string, nestedRoot);
    const hashField = pathField.replace("Path", "Sha256");
    fixture.evidence[hashField] = sha256(nestedRoot);

    expect(codes(validate(fixture))).toContain("CANONICAL_ROOT_INVALID");
  });

  it("rejects a root carrying any attribute beyond the neutral marker", () => {
    const fixture = createExplicitFixture();
    replaceExplicitCaptures(
      fixture,
      canonicalRaw.replace('data-rdx-content-root=""', 'class="content" data-rdx-content-root=""')
    );

    expect(codes(validate(fixture))).toContain("CANONICAL_ROOT_INVALID");
  });

  it("rejects an additional root hidden inside template content", () => {
    const fixture = createExplicitFixture();
    replaceExplicitCaptures(
      fixture,
      canonicalRaw.replace(
        '<h1 class="heading">',
        '<template><span data-rdx-content-root=""></span></template><h1 class="heading">'
      )
    );

    expect(codes(validate(fixture))).toContain("CANONICAL_ROOT_INVALID");
  });

  it.each([
    ["@import", '@import "theme.css";'],
    ["@font-face", "@font-face{font-family:evidence;src:url(font.woff2)}"],
    ["@media screen", "@media screen{[data-rdx-content-root] .screen{color:red}}"],
    ["@supports", "@supports(display:block){[data-rdx-content-root] .supported{display:block}}"],
    ["@page", "@page{margin:1cm}"],
    ["@namespace", '@namespace svg url("urn:evidence");']
  ])("review regression: rejects forbidden retained at-rule %s", (_label, atRule) => {
    const fixture = createExplicitFixture();
    replaceExplicitCaptures(fixture, explicitRawWithStylesheetPrefix(atRule));

    expect(codes(validate(fixture))).toEqual([
      "STYLESHEET_POLICY_INVALID",
      "STYLESHEET_POLICY_INVALID",
      "STYLESHEET_POLICY_INVALID"
    ]);
  });

  it("review regression: rejects every Raw node in a retained stylesheet", () => {
    const fixture = createExplicitFixture();
    replaceExplicitCaptures(
      fixture,
      canonicalRaw.replace(
        "border:1px solid black;color:#253342",
        "--evidence:unparsed;border:1px solid black;color:#253342"
      )
    );

    expect(codes(validate(fixture))).toEqual([
      "STYLESHEET_POLICY_INVALID",
      "STYLESHEET_POLICY_INVALID",
      "STYLESHEET_POLICY_INVALID"
    ]);
  });

  it("review regression: inspects unscoped styles inside template content", () => {
    const fixture = createExplicitFixture();
    replaceExplicitCaptures(
      fixture,
      canonicalRaw.replace(
        '<h1 class="heading">',
        '<template><style>body{color:red}</style></template><h1 class="heading">'
      )
    );

    expect(codes(validate(fixture))).toEqual([
      "STYLE_SELECTOR_UNSCOPED",
      "STYLE_SELECTOR_UNSCOPED",
      "STYLE_SELECTOR_UNSCOPED"
    ]);
  });

  it.each([
    ["unscoped sibling branch", ",body .escape"],
    ["rooted sibling escape", ",[data-rdx-content-root]~.escape"]
  ])("rejects every %s in retained stylesheets", (_label, selectorSuffix) => {
    const fixture = createExplicitFixture();
    replaceExplicitCaptures(
      fixture,
      canonicalRaw.replace(
        "[data-rdx-content-root] .heading{",
        `[data-rdx-content-root] .heading${selectorSuffix}{`
      )
    );

    expect(codes(validate(fixture))).toContain("STYLE_SELECTOR_UNSCOPED");
  });

  it("parses and rejects malformed retained stylesheet rules without throwing", () => {
    const fixture = createExplicitFixture();
    replaceExplicitCaptures(
      fixture,
      canonicalRaw.replace("[data-rdx-content-root] table", "[data-rdx-content-root] :not(")
    );

    expect(codes(validate(fixture))).toContain("STYLESHEET_INVALID");
  });

  it("checks scoping in the refreshed canonical capture as well", () => {
    const fixture = createExplicitFixture();
    const unscoped = canonicalRaw.replace(
      "[data-rdx-content-root] .heading{",
      "[data-rdx-content-root] .heading,body{"
    );
    writeRelative(fixture.root, fixture.evidence.afterRefreshRawPath as string, unscoped);
    fixture.evidence.afterRefreshRawSha256 = sha256(unscoped);

    expect(codes(validate(fixture))).toContain("STYLE_SELECTOR_UNSCOPED");
  });
});

describe("regression evidence CLI", () => {
  it.each([
    ["custom-field", createCustomFixture],
    ["explicit-system-description", createExplicitFixture]
  ])("validates %s local evidence and labels it as non-Azure", (_scenario, createFixture) => {
    const result = runVerifier(createFixture());

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("LOCAL DRY RUN ONLY - NOT AZURE-HOST EVIDENCE");
    expect(result.stdout).toContain("PASS");
    expect(result.stderr).toBe("");
  });

  it("prints bounded structured failures and exits non-zero for invalid evidence", () => {
    const fixture = createCustomFixture();
    fixture.evidence.beforeTableCount = 5;
    persistEvidence(fixture);

    const result = runVerifier(fixture);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("LOCAL DRY RUN ONLY - NOT AZURE-HOST EVIDENCE");
    expect(result.stderr).toContain("INVALID_TABLE_COUNT");
    expect(result.stderr).not.toContain(customRaw);
  });

  it("rejects malformed JSON without printing its content or a raw internal error", () => {
    const fixture = createCustomFixture();
    writeFileSync(fixture.evidencePath, "{ SECRET_MALFORMED_JSON");

    const result = runVerifier(fixture);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("EVIDENCE_JSON_INVALID");
    expect(result.stderr).not.toContain("SECRET_MALFORMED_JSON");
    expect(result.stderr).not.toContain("SyntaxError");
  });

  it("rejects a missing JSON file deterministically", () => {
    const fixture = createCustomFixture();
    const result = runVerifier(fixture, [], join(fixture.root, "missing.json"));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("EVIDENCE_FILE_MISSING");
    expect(result.stderr).not.toContain("ENOENT");
  });

  it("does not follow an evidence JSON symlink", () => {
    const fixture = createCustomFixture();
    const linkPath = join(fixture.root, "linked-evidence.json");
    symlinkSync(fixture.evidencePath, linkPath);

    const result = runVerifier(fixture, [], linkPath);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("EVIDENCE_SYMLINK_FORBIDDEN");
  });

  it("review regression: rejects a symlinked JSON ancestor in enforced Azure mode", () => {
    const fixture = createCustomFixture();
    fixture.evidence.evidenceKind = "azure-host";
    persistEvidence(fixture);
    const aliasParent = createRoot();
    const aliasRoot = join(aliasParent, "evidence-alias");
    symlinkSync(fixture.root, aliasRoot, "dir");

    const result = runVerifier(
      fixture,
      ["--require-azure-host"],
      join(aliasRoot, "evidence.json")
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("EVIDENCE_SYMLINK_FORBIDDEN");
    expect(result.stdout).not.toContain("PASS");
  });

  it("review regression: distinguishes unreadable JSON from malformed JSON", () => {
    const fixture = createCustomFixture();
    chmodSync(fixture.evidencePath, 0o000);

    const result = runVerifier(fixture);
    chmodSync(fixture.evidencePath, 0o600);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("EVIDENCE_FILE_UNREADABLE");
    expect(result.stderr).not.toContain("EVIDENCE_JSON_INVALID");
  });

  it("review regression: rejects an unreadable screenshot in enforced Azure mode", () => {
    const fixture = createCustomFixture();
    fixture.evidence.evidenceKind = "azure-host";
    persistEvidence(fixture);
    const screenshot = join(fixture.root, fixture.evidence.beforeScreenshot as string);
    chmodSync(screenshot, 0o000);

    const result = runVerifier(fixture, ["--require-azure-host"]);
    chmodSync(screenshot, 0o600);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("FILE_UNREADABLE");
    expect(result.stdout).not.toContain("PASS");
  });

  it.each([
    ["forbidden at-rule", explicitRawWithStylesheetPrefix('@import "theme.css";')],
    [
      "template-contained style",
      canonicalRaw.replace(
        '<h1 class="heading">',
        '<template><style>body{color:red}</style></template><h1 class="heading">'
      )
    ]
  ])("review regression: rejects %s in enforced Azure mode", (_label, raw) => {
    const fixture = createExplicitFixture();
    fixture.evidence.evidenceKind = "azure-host";
    replaceExplicitCaptures(fixture, raw);
    persistEvidence(fixture);

    const result = runVerifier(fixture, ["--require-azure-host"]);

    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain("PASS");
  });

  it.each([
    ["custom-field", createCustomFixture],
    ["explicit-system-description", createExplicitFixture]
  ])("rejects %s local evidence for the Azure-host gate", (_scenario, createFixture) => {
    const fixture = createFixture();
    const result = runVerifier(fixture, ["--require-azure-host"]);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("LOCAL DRY RUN ONLY - NOT AZURE-HOST EVIDENCE");
    expect(result.stderr).toContain("AZURE_HOST_REQUIRED");
  });

  it.each([
    ["custom-field", createCustomFixture],
    ["explicit-system-description", createExplicitFixture]
  ])("accepts valid %s Azure-host evidence for the external gate", (_scenario, createFixture) => {
    const fixture = createFixture();
    fixture.evidence.evidenceKind = "azure-host";
    persistEvidence(fixture);

    const result = runVerifier(fixture, ["--require-azure-host"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("AZURE-HOST EVIDENCE");
    expect(result.stdout).toContain("PASS");
  });
});
