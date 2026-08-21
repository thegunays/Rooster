import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

type JsonObject = Record<string, unknown>;

interface ReleaseFailure {
  readonly code: string;
  readonly message: string;
}

interface ReleaseContractModule {
  readBoundedRegularFile(
    path: string,
    maxBytes: number,
    options?: { readonly noFollowFlag?: number }
  ): Buffer;
  readReleaseContract(repositoryRoot: string): {
    readonly failures: ReleaseFailure[];
  };
  syncReleaseVersion(repositoryRoot: string): {
    readonly changed: boolean;
    readonly version: string;
  };
  validateReleaseContract(data: {
    readonly manifest: JsonObject;
    readonly packageJson: JsonObject;
    readonly packageLock: JsonObject;
  }): {
    readonly failures: ReleaseFailure[];
  };
}

const releaseContract = await import(
  pathToFileURL(resolve("scripts/lib/release-contract.mjs")).href
) as unknown as ReleaseContractModule;
const {
  readReleaseContract,
  syncReleaseVersion,
  validateReleaseContract
} = releaseContract;

const temporaryRoots: string[] = [];

const expectedScripts = {
  clean: "node scripts/clean-generated.mjs",
  typecheck: "tsc --noEmit",
  build: "npm run clean && webpack --mode production",
  "build:harness": "npm run clean && webpack --mode development --env harness",
  "check:build-outputs": "node scripts/check-build-outputs.mjs",
  "build:dev": "npm run clean && webpack --mode development",
  test: "vitest run",
  "test:watch": "vitest",
  "audit:prod": "npm audit --omit=dev",
  "check:release": "node scripts/check-release-contract.mjs",
  "package:vsix":
    "npm run build && npm run check:release && node scripts/package-vsix.mjs && node scripts/verify-vsix.mjs",
  verify:
    "npm run typecheck && npm test && npm run build && npm run check:build-outputs -- production && npm run build:harness && npm run check:build-outputs -- harness && npm run package:vsix"
};

const expectedDependencies = {
  "azure-devops-extension-api": "4.266.0",
  "azure-devops-extension-sdk": "4.2.0",
  "css-tree": "3.2.1",
  dompurify: "3.4.13",
  roosterjs: "9.45.2"
};

const expectedDevDependencies = {
  "@types/css-tree": "3.2.0",
  "@types/node": "24.5.2",
  jsdom: "26.1.0",
  rimraf: "6.0.1",
  "tfx-cli": "0.23.1",
  "ts-loader": "9.5.4",
  typescript: "5.9.2",
  vitest: "^4.1.2",
  webpack: "^5.105.4",
  "webpack-cli": "6.0.1"
};

function validManifest(version = "0.1.21"): JsonObject {
  return {
    manifestVersion: 1,
    id: "roosterjs-description-editor",
    publisher: "ygdb121",
    version,
    name: "Rooster Description Editor",
    description:
      "Adds a RoosterJS-based rich editor control for System.Description on selected work item types.",
    public: false,
    categories: ["Plan and track"],
    targets: [{ id: "Microsoft.VisualStudio.Services" }],
    scopes: ["vso.work_write"],
    files: [
      { path: "static", addressable: true },
      { path: "dist", addressable: true }
    ],
    contributions: [
      {
        id: "rooster-description-control",
        type: "ms.vss-work-web.work-item-form-control",
        description: "RoosterJS editor for System.Description",
        targets: ["ms.vss-work-web.work-item-form"],
        properties: {
          name: "Description (Rooster)",
          uri: "static/control.html",
          height: 570,
          inputs: [
            {
              id: "FieldName",
              description: "Target field reference name.",
              type: "WorkItemField",
              properties: { workItemFieldTypes: ["HTML"] },
              validation: { dataType: "String", isRequired: true }
            },
            {
              id: "EnabledWits",
              description: "Comma-separated list of enabled work item types.",
              validation: { dataType: "String", isRequired: true }
            },
            {
              id: "DebounceMs",
              description: "Autosync debounce value in milliseconds.",
              validation: { dataType: "String", isRequired: false }
            },
            {
              id: "EnableMarkdownAutoformat",
              description: "Enable markdown auto-format shortcuts.",
              validation: { dataType: "String", isRequired: false }
            },
            {
              id: "EnableCodeBlock",
              description: "Enable code block toolbar action.",
              validation: { dataType: "String", isRequired: false }
            }
          ]
        }
      }
    ]
  };
}

function validPackage(version = "0.1.21"): JsonObject {
  return {
    name: "roosterjs-ado-ext",
    version,
    private: true,
    description: "Azure DevOps work item custom control using RoosterJS for System.Description",
    scripts: structuredClone(expectedScripts),
    dependencies: structuredClone(expectedDependencies),
    devDependencies: structuredClone(expectedDevDependencies)
  };
}

function validLock(version = "0.1.21"): JsonObject {
  const directPackages: Record<string, JsonObject> = {};
  for (const [name, installedVersion] of Object.entries({
    ...expectedDependencies,
    ...expectedDevDependencies,
    vitest: "4.1.2",
    webpack: "5.105.4"
  })) {
    directPackages[`node_modules/${name}`] = {
      version: installedVersion.replace(/^\^/, "")
    };
  }

  directPackages["node_modules/system-architecture"] = { version: "0.1.0" };

  return {
    name: "roosterjs-ado-ext",
    version,
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": {
        name: "roosterjs-ado-ext",
        version,
        dependencies: structuredClone(expectedDependencies),
        devDependencies: structuredClone(expectedDevDependencies)
      },
      ...directPackages
    }
  };
}

function validData(version = "0.1.21") {
  return {
    manifest: validManifest(version),
    packageJson: validPackage(version),
    packageLock: validLock(version)
  };
}

function createRepository(options?: {
  version?: string;
  packageVersion?: string;
  lockVersion?: string;
  indentation?: string;
}): string {
  const repositoryRoot = mkdtempSync(join(tmpdir(), "rooster-release-contract-"));
  temporaryRoots.push(repositoryRoot);
  const version = options?.version ?? "0.1.21";
  const packageVersion = options?.packageVersion ?? version;
  const lockVersion = options?.lockVersion ?? version;
  const indentation = options?.indentation ?? "  ";

  const manifest = validManifest(version);
  const packageJson = validPackage(packageVersion);
  const packageLock = validLock(lockVersion);
  (packageLock.packages as Record<string, JsonObject>)[""].version = lockVersion;

  writeFileSync(
    join(repositoryRoot, "vss-extension.json"),
    `${JSON.stringify(manifest, null, indentation)}\n`
  );
  writeFileSync(
    join(repositoryRoot, "package.json"),
    `${JSON.stringify(packageJson, null, indentation)}\n`
  );
  writeFileSync(
    join(repositoryRoot, "package-lock.json"),
    `${JSON.stringify(packageLock, null, indentation)}\n`
  );
  return repositoryRoot;
}

function writeJsonAtExactSize(path: string, value: JsonObject, byteSize: number): void {
  const json = Buffer.from(JSON.stringify(value), "utf8");
  if (json.length > byteSize) {
    throw new Error("Controlled JSON exceeds requested test size.");
  }
  writeFileSync(path, Buffer.concat([json, Buffer.alloc(byteSize - json.length, 0x20)]));
}

function codes(result: { failures: Array<{ code: string }> }): string[] {
  return result.failures.map(failure => failure.code);
}

afterEach(() => {
  while (temporaryRoots.length > 0) {
    rmSync(temporaryRoots.pop()!, { recursive: true, force: true });
  }
});

describe("release contract", () => {
  it("accepts a fully aligned future manifest version without hard-coding 0.1.21", () => {
    expect(validateReleaseContract(validData("0.1.22")).failures).toEqual([]);
  });

  it.each([
    ["package", (data: ReturnType<typeof validData>) => (data.packageJson.version = "0.1.20")],
    ["lock", (data: ReturnType<typeof validData>) => (data.packageLock.version = "0.1.20")],
    [
      "lock root",
      (data: ReturnType<typeof validData>) =>
        (((data.packageLock.packages as Record<string, JsonObject>)[""]).version = "0.1.20")
    ]
  ])("rejects a stale %s version mirror", (_label, mutate) => {
    const data = validData();
    mutate(data);
    expect(codes(validateReleaseContract(data))).toContain("VERSION_MISMATCH");
  });

  it.each([
    ["manifestVersion", 2],
    ["id", "other-id"],
    ["publisher", "other-publisher"],
    ["name", "Other Name"],
    ["description", "Other description"],
    ["public", true]
  ])("rejects immutable manifest %s drift", (key, value) => {
    const data = validData();
    data.manifest[key] = value;
    expect(codes(validateReleaseContract(data))).toContain("MANIFEST_CONTRACT_INVALID");
  });

  it.each([
    ["categories", ["Plan and track", "Other"]],
    ["targets", [{ id: "Other.Target" }]],
    ["scopes", ["vso.work_write", "vso.code"]],
    ["files", [{ path: "dist", addressable: true }, { path: "static", addressable: true }]],
    ["contributions", []]
  ])("rejects manifest collection drift in %s", (key, value) => {
    const data = validData();
    data.manifest[key] = value;
    expect(codes(validateReleaseContract(data))).toContain("MANIFEST_CONTRACT_INVALID");
  });

  it.each([
    ["id", "other-control"],
    ["type", "other.type"],
    ["description", "Other contribution"],
    ["targets", ["other.target"]],
    ["properties", { name: "Description (Rooster)", uri: "static/control.html", height: 700 }]
  ])("rejects contribution %s drift", (key, value) => {
    const data = validData();
    const contribution = (data.manifest.contributions as JsonObject[])[0];
    contribution[key] = value;
    expect(codes(validateReleaseContract(data))).toContain("MANIFEST_CONTRACT_INVALID");
  });

  it("rejects reordered, missing, extra, and altered input contracts", () => {
    for (const mutate of [
      (inputs: JsonObject[]) => inputs.reverse(),
      (inputs: JsonObject[]) => inputs.pop(),
      (inputs: JsonObject[]) => inputs.push(structuredClone(inputs[0])),
      (inputs: JsonObject[]) => {
        (inputs[0].validation as JsonObject).isRequired = false;
      },
      (inputs: JsonObject[]) => {
        (inputs[0].properties as JsonObject).workItemFieldTypes = ["String"];
      },
      (inputs: JsonObject[]) => {
        (inputs[0].validation as JsonObject).dataType = "WorkItemField";
      },
      (inputs: JsonObject[]) => {
        (inputs[0].validation as JsonObject).properties = inputs[0].properties;
        delete inputs[0].properties;
      },
      (inputs: JsonObject[]) => {
        inputs[1].description = "Other";
      }
    ]) {
      const data = validData();
      const contribution = (data.manifest.contributions as JsonObject[])[0];
      const inputs = ((contribution.properties as JsonObject).inputs as JsonObject[]);
      mutate(inputs);
      expect(codes(validateReleaseContract(data))).toContain("MANIFEST_CONTRACT_INVALID");
    }
  });

  it("rejects legacy root-level control inputs", () => {
    const data = validData();
    const contribution = (data.manifest.contributions as JsonObject[])[0];
    const properties = contribution.properties as JsonObject;
    contribution.inputs = properties.inputs;
    delete properties.inputs;

    expect(codes(validateReleaseContract(data))).toContain("MANIFEST_CONTRACT_INVALID");
  });

  it("rejects unknown own fields and property-order drift at packaging boundaries", () => {
    const withExtra = validData();
    withExtra.manifest.repository = { type: "git", uri: "https://invalid.example" };
    expect(codes(validateReleaseContract(withExtra))).toContain("MANIFEST_CONTRACT_INVALID");

    const reordered = validData();
    reordered.manifest = {
      id: reordered.manifest.id,
      manifestVersion: reordered.manifest.manifestVersion,
      ...Object.fromEntries(Object.entries(reordered.manifest).slice(2))
    };
    expect(codes(validateReleaseContract(reordered))).toContain("MANIFEST_CONTRACT_INVALID");

    const packageExtra = validData();
    packageExtra.packageJson.publishConfig = { access: "public" };
    expect(codes(validateReleaseContract(packageExtra))).toContain("PACKAGE_CONTRACT_INVALID");

    const lockExtra = validData();
    lockExtra.packageLock.publish = true;
    expect(codes(validateReleaseContract(lockExtra))).toContain("LOCK_CONTRACT_INVALID");
  });

  it("rejects inherited and accessor-backed security fields", () => {
    const inherited = validData();
    const ownManifest = inherited.manifest;
    const manifestWithoutPublisher = Object.fromEntries(
      Object.entries(ownManifest).filter(([key]) => key !== "publisher")
    );
    inherited.manifest = Object.assign(
      Object.create({ publisher: "ygdb121" }),
      manifestWithoutPublisher
    );
    expect(codes(validateReleaseContract(inherited))).toContain("MANIFEST_CONTRACT_INVALID");

    const accessor = validData();
    Object.defineProperty(accessor.packageJson, "private", {
      enumerable: true,
      get: () => true
    });
    expect(codes(validateReleaseContract(accessor))).toContain("PACKAGE_CONTRACT_INVALID");
  });

  it("does not invoke accessors on the release input envelope", () => {
    const data = validData();
    const hostile = {
      packageJson: data.packageJson,
      packageLock: data.packageLock
    } as ReturnType<typeof validData>;
    Object.defineProperty(hostile, "manifest", {
      enumerable: true,
      get: () => {
        throw new Error("DO_NOT_EXPOSE_ACCESSOR_CONTENT");
      }
    });

    expect(() => validateReleaseContract(hostile)).not.toThrow();
    expect(codes(validateReleaseContract(hostile))).toContain("MANIFEST_CONTRACT_INVALID");
  });

  it("freezes package identity, scripts, dependency declarations, and installed direct versions", () => {
    const cases: Array<(data: ReturnType<typeof validData>) => void> = [
      data => {
        data.packageJson.name = "other";
      },
      data => {
        data.packageJson.private = false;
      },
      data => {
        (data.packageJson.scripts as JsonObject)["package:vsix"] = "tfx extension publish";
      },
      data => {
        (data.packageJson.dependencies as JsonObject).dompurify = "^3.4.13";
      },
      data => {
        (data.packageJson.devDependencies as JsonObject)["tfx-cli"] = "^0.23.1";
      },
      data => {
        const packages = data.packageLock.packages as Record<string, JsonObject>;
        packages["node_modules/css-tree"].version = "3.2.0";
      },
      data => {
        const packages = data.packageLock.packages as Record<string, JsonObject>;
        packages["node_modules/tfx-cli"].version = "0.22.0";
      }
    ];

    for (const mutate of cases) {
      const data = validData();
      mutate(data);
      expect(validateReleaseContract(data).failures.length).toBeGreaterThan(0);
    }
  });

  it("reads only regular non-symlink release inputs", () => {
    const regularRoot = createRepository();
    expect(readReleaseContract(regularRoot).failures).toEqual([]);

    const directoryRoot = createRepository();
    rmSync(join(directoryRoot, "package.json"));
    mkdirSync(join(directoryRoot, "package.json"));
    expect(codes(readReleaseContract(directoryRoot))).toContain("RELEASE_INPUT_INVALID");

    const symlinkRoot = createRepository();
    const target = join(symlinkRoot, "package.real.json");
    writeFileSync(target, readFileSync(join(symlinkRoot, "package.json")));
    rmSync(join(symlinkRoot, "package.json"));
    symlinkSync(target, join(symlinkRoot, "package.json"));
    expect(lstatSync(join(symlinkRoot, "package.json")).isSymbolicLink()).toBe(true);
    expect(codes(readReleaseContract(symlinkRoot))).toContain("RELEASE_INPUT_INVALID");
  });

  it("reports malformed input without exposing content", () => {
    const repositoryRoot = createRepository();
    const secret = "DO_NOT_PRINT_SECRET_RELEASE_CONTENT";
    writeFileSync(join(repositoryRoot, "package.json"), `{${secret}`);

    const result = readReleaseContract(repositoryRoot);
    expect(codes(result)).toContain("RELEASE_JSON_INVALID");
    expect(JSON.stringify(result.failures)).not.toContain(secret);
  });

  it.each([
    "vss-extension.json",
    "package.json",
    "package-lock.json"
  ])("rejects oversized %s before JSON parsing", fileName => {
    const repositoryRoot = createRepository();
    truncateSync(join(repositoryRoot, fileName), (8 * 1024 * 1024) + 1);

    expect(codes(readReleaseContract(repositoryRoot))).toContain(
      "RELEASE_INPUT_TOO_LARGE"
    );
  });

  it("accepts a valid release JSON input at the exact byte cap", () => {
    const repositoryRoot = createRepository();
    writeJsonAtExactSize(
      join(repositoryRoot, "package.json"),
      validPackage(),
      8 * 1024 * 1024
    );

    expect(readReleaseContract(repositoryRoot).failures).toEqual([]);
  });

  it.runIf(process.platform !== "win32")(
    "rejects a FIFO release input without blocking",
    () => {
      const repositoryRoot = createRepository();
      const packagePath = join(repositoryRoot, "package.json");
      rmSync(packagePath);
      const fifo = spawnSync("mkfifo", [packagePath], { encoding: "utf8" });
      expect(fifo.status).toBe(0);

      const result = spawnSync(
        process.execPath,
        [resolve("scripts/check-release-contract.mjs"), "--repository-root", repositoryRoot],
        { encoding: "utf8", timeout: 750, killSignal: "SIGKILL" }
      );

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("RELEASE_INPUT_INVALID");
    }
  );

  it("rejects a symlink when no no-follow open flag is available", () => {
    const repositoryRoot = createRepository();
    const packagePath = join(repositoryRoot, "package.json");
    const target = join(repositoryRoot, "package.real.json");
    writeFileSync(target, readFileSync(packagePath));
    rmSync(packagePath);
    symlinkSync(target, packagePath);

    expect(() => releaseContract.readBoundedRegularFile(
      packagePath,
      8 * 1024 * 1024,
      { noFollowFlag: 0 }
    )).toThrow(expect.objectContaining({ reason: "invalid" }));
  });

  it.runIf(existsSync("/dev/fd"))(
    "closes the release descriptor after a capped-read failure",
    () => {
      const repositoryRoot = createRepository();
      truncateSync(join(repositoryRoot, "package.json"), (8 * 1024 * 1024) + 1);
      const before = readdirSync("/dev/fd").length;

      for (let attempt = 0; attempt < 32; attempt += 1) {
        expect(codes(readReleaseContract(repositoryRoot))).toContain(
          "RELEASE_INPUT_TOO_LARGE"
        );
      }

      expect(readdirSync("/dev/fd").length).toBeLessThanOrEqual(before + 4);
    }
  );
});

describe("explicit release version synchronization", () => {
  it("changes only the three mirror values while preserving formatting and unrelated packages", () => {
    const repositoryRoot = createRepository({
      packageVersion: "0.1.0",
      lockVersion: "0.1.0",
      indentation: "    "
    });
    const manifestBefore = readFileSync(join(repositoryRoot, "vss-extension.json"));
    const packageBefore = readFileSync(join(repositoryRoot, "package.json"), "utf8");
    const lockBefore = readFileSync(join(repositoryRoot, "package-lock.json"), "utf8");

    const result = syncReleaseVersion(repositoryRoot);

    expect(result).toEqual({ changed: true, version: "0.1.21" });
    expect(readFileSync(join(repositoryRoot, "vss-extension.json"))).toEqual(manifestBefore);
    const packageAfter = readFileSync(join(repositoryRoot, "package.json"), "utf8");
    const lockAfter = readFileSync(join(repositoryRoot, "package-lock.json"), "utf8");
    expect(packageAfter).toBe(packageBefore.replace('"version": "0.1.0"', '"version": "0.1.21"'));
    expect(lockAfter).toBe(
      lockBefore
        .replace('"version": "0.1.0"', '"version": "0.1.21"')
        .replace('"version": "0.1.0"', '"version": "0.1.21"')
    );
    expect(
      ((JSON.parse(lockAfter).packages as Record<string, JsonObject>)[
        "node_modules/system-architecture"
      ]).version
    ).toBe("0.1.0");
    expect(packageAfter.endsWith("\n")).toBe(true);
    expect(lockAfter.endsWith("\n")).toBe(true);
  });

  it("is byte-idempotent on a second run", () => {
    const repositoryRoot = createRepository({ packageVersion: "0.1.0", lockVersion: "0.1.0" });
    syncReleaseVersion(repositoryRoot);
    const packageOnce = readFileSync(join(repositoryRoot, "package.json"));
    const lockOnce = readFileSync(join(repositoryRoot, "package-lock.json"));

    expect(syncReleaseVersion(repositoryRoot)).toEqual({ changed: false, version: "0.1.21" });
    expect(readFileSync(join(repositoryRoot, "package.json"))).toEqual(packageOnce);
    expect(readFileSync(join(repositoryRoot, "package-lock.json"))).toEqual(lockOnce);
  });

  it("prevalidates every input and writes nothing when one input is malformed", () => {
    const repositoryRoot = createRepository({ packageVersion: "0.1.0", lockVersion: "0.1.0" });
    const packageBefore = readFileSync(join(repositoryRoot, "package.json"));
    writeFileSync(join(repositoryRoot, "package-lock.json"), "{ malformed\n");
    const lockBefore = readFileSync(join(repositoryRoot, "package-lock.json"));

    expect(() => syncReleaseVersion(repositoryRoot)).toThrow("Release synchronization blocked");
    expect(readFileSync(join(repositoryRoot, "package.json"))).toEqual(packageBefore);
    expect(readFileSync(join(repositoryRoot, "package-lock.json"))).toEqual(lockBefore);
  });

  it("refuses immutable drift instead of synchronizing around it", () => {
    const repositoryRoot = createRepository({ packageVersion: "0.1.0", lockVersion: "0.1.0" });
    const manifest = JSON.parse(readFileSync(join(repositoryRoot, "vss-extension.json"), "utf8"));
    manifest.public = true;
    writeFileSync(join(repositoryRoot, "vss-extension.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    const packageBefore = readFileSync(join(repositoryRoot, "package.json"));

    expect(() => syncReleaseVersion(repositoryRoot)).toThrow("Release synchronization blocked");
    expect(readFileSync(join(repositoryRoot, "package.json"))).toEqual(packageBefore);
  });

  it("rolls back the first mirror if a later filesystem write fails", () => {
    const repositoryRoot = createRepository({ packageVersion: "0.1.0", lockVersion: "0.1.0" });
    const packagePath = join(repositoryRoot, "package.json");
    const lockPath = join(repositoryRoot, "package-lock.json");
    const packageBefore = readFileSync(packagePath);
    const lockBefore = readFileSync(lockPath);
    chmodSync(lockPath, 0o444);

    expect(() => syncReleaseVersion(repositoryRoot)).toThrow("Release synchronization blocked");
    expect(readFileSync(packagePath)).toEqual(packageBefore);
    expect(readFileSync(lockPath)).toEqual(lockBefore);
  });
});

describe("release checker CLI", () => {
  it("is read-only and emits bounded content-free failures", () => {
    const repositoryRoot = createRepository({ packageVersion: "0.1.0", lockVersion: "0.1.0" });
    const secret = "DO_NOT_PRINT_PACKAGE_BODY";
    const packagePath = join(repositoryRoot, "package.json");
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
    packageJson.description = secret;
    writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
    const before = ["vss-extension.json", "package.json", "package-lock.json"].map(file =>
      readFileSync(join(repositoryRoot, file))
    );

    const result = spawnSync(
      process.execPath,
      [resolve("scripts/check-release-contract.mjs"), "--repository-root", repositoryRoot],
      { encoding: "utf8" }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("RELEASE_CONTRACT_FAILED");
    expect(result.stderr).not.toContain(secret);
    expect(result.stderr.length).toBeLessThan(4096);
    expect(["vss-extension.json", "package.json", "package-lock.json"].map(file =>
      readFileSync(join(repositoryRoot, file))
    )).toEqual(before);
  });

  it("passes a controlled aligned future-version repository", () => {
    const repositoryRoot = createRepository({ version: "0.1.22" });
    const result = spawnSync(
      process.execPath,
      [resolve("scripts/check-release-contract.mjs"), "--repository-root", repositoryRoot],
      { encoding: "utf8" }
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("Release contract verified.\n");
    expect(result.stderr).toBe("");
  });
});
