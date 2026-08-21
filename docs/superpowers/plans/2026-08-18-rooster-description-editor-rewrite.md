# Rooster Description Editor Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a behavior-equivalent, security-hardened Azure DevOps Rooster Description Editor that preserves the existing contribution contract, isolates the configured HTML field from System.Description, safely scopes BKU template CSS, and passes deterministic test/build/package gates.

**Architecture:** Keep the existing canonical module boundaries and Azure DevOps iframe composition root. Replace each boundary behind characterization tests: configuration and Work Item data capability, canonical HTML/CSS normalization, serialized synchronization, Rooster/table UI, lifecycle coordination, regression harness, and release verification. The production bundle contains one implementation; the main branch remains untouched while this isolated branch evolves.

**Tech Stack:** TypeScript 5.9, Vitest 4 with jsdom, Webpack 5, RoosterJS 9.45.2, Azure DevOps Extension SDK/API, DOMPurify 3.4.13, css-tree 3.2.1, tfx-cli 0.23.1, Node.js 24.

**Spec:** `docs/superpowers/specs/2026-08-18-rooster-description-editor-rewrite-design.md`

## Global Constraints

- Work only in the linked worktree `/Users/gnx/Repo/Rooster0.1.1-rewrite-rooster-description-editor` on branch `rewrite/rooster-description-editor`.
- Preserve extension ID `roosterjs-description-editor`, publisher `ygdb121`, contribution ID `rooster-description-control`, contribution type `ms.vss-work-web.work-item-form-control`, target `Microsoft.VisualStudio.Services`, `public:false`, scope `vso.work_write`, URI `static/control.html`, contribution name `Description (Rooster)`, height `570`, and all five manifest inputs.
- Run entirely inside the browser/iframe. Add no backend, database, custom API, auth/token flow, browser content persistence, external telemetry, or Work Item data access outside `IWorkItemFormService`.
- Read/write only the immutable explicitly configured `FieldName`. Never write System.Description unless the raw configuration explicitly names it.
- Perform no writes in read-only mode and create no target-field read, editor, or SyncEngine for unsupported WITs.
- Normalize every inbound and outbound HTML value through one canonical sanitizer boundary.
- Preserve exact source-authoritative labels, strings, toolbar/menu behavior, telemetry event names, and manifest identity unless this plan identifies an approved hardening difference.
- Keep RoosterJS pinned at `9.45.2`. The private code-block imports remain isolated and receive contract tests.
- Add exact `css-tree@3.2.1`, `@types/css-tree@3.2.0`, and `dompurify@3.4.13`.
- The aggregate extracted stylesheet limit is `100,000` characters.
- The canonical persistent scope marker is exactly `<div data-rdx-content-root="">…</div>` and is recreated neutral on every normalization.
- Keep `@media print` only; reject every other at-rule and all CSS `url()` forms.
- Use TDD for production behavior: write a focused test, run it and record the expected failure, implement the minimum, rerun focused tests, then broader tests.
- Never leave the branch failing at a task boundary. Generated `node_modules`, `dist`, `artifacts`, VSIX files, platform binaries, and SDD workspace files remain untracked/ignored.
- Each task ends in its own commit, implementer self-review, generated review package, specification verdict, code-quality verdict, and any required fix/re-review loop.
- Sanitizer and lifecycle tasks require two independent reviewers. SyncEngine and Table Context Menu require explicit independent specification and quality verdicts even when one reviewer supplies both.
- Do not push, merge, publish, install a VSIX, or mutate an external Azure DevOps organization without explicit user approval.

## Planned File Ownership and Interfaces

| Area | Canonical owner task | Files/interfaces produced |
| --- | --- | --- |
| BKU oracle and acceptance matrix | Task 1 | `test/fixtures/bku-template.html`, provenance, fixture test, `docs/acceptance-matrix.md` |
| Build/harness entry | Task 2 | package build scripts, mode-aware Webpack entries, strict test typecheck, minimal harness bundle |
| Config/bridge/telemetry | Task 3 | immutable `ControlConfig`, `fieldNameWasExplicit`, `WorkItemBridge` port, telemetry runtime filter |
| HTML/CSS security | Task 4 | `HtmlNormalizer` and canonical `Sanitizer.normalizeHtml` |
| Synchronization | Task 5 | failure-safe `SyncEngine` with `alignToHost` |
| Tables/menu | Task 6 | logical selection snapshot, accessible `TableContextMenu` |
| Editor host | Task 7 | injectable `RoosterHost`/view contract and code-block contract |
| Lifecycle/bootstrap | Task 8 | injected controller ports, generation guard, SDK composition/error contract |
| Independence/harness integration | Task 9 | fake-host integration, full local harness/debug panel |
| Azure evidence contract | Task 10 | evidence schema/verifier/runbook and local failing/passing dry run |
| Release/package | Task 11 | version sync/check, VSIX verifier, CI, release notes, candidate artifact |

Shared-file sequencing is binding:

- Task 2 first owns `package.json`, `webpack.config.js`, `tsconfig.json`, `src/test-harness.ts`, and `test.html`; it does not touch the lockfile because it adds no dependency.
- Task 4 later owns only the dependency delta in `package.json`/`package-lock.json`.
- Task 9 expands the already-working harness without changing its build contract.
- Task 11 owns final scripts/version/package/CI changes and rebases its lockfile work on Task 4.
- Task 4 performs only the mechanical `sanitizeHtml` to `normalizeHtml` consumer rename in the controller; Task 8 owns the controller rewrite.
- Task 6 lands before Task 7 so RoosterHost consumes the final table-menu contract.

Acceptance ownership is also binding; later integration tasks may add evidence but may not weaken an earlier oracle:

| Acceptance criteria | Primary task | Required follow-through |
| --- | --- | --- |
| AC-01, AC-02, AC-03, AC-12 | Task 8 lifecycle | Task 9 fake-host integration and harness evidence |
| AC-04, AC-05, AC-13, AC-14 | Task 4 sanitizer/CSS | Task 9 BKU harness evidence |
| AC-06, AC-07, AC-10 | Task 5 synchronization | Task 8 status/telemetry integration |
| AC-08 | Task 5 flush state machine | Task 8 save lifecycle and Task 9 integration |
| AC-09 | Task 6 logical table/menu | Task 7 editor component and Task 9 harness interaction |
| AC-11 | Task 9 custom-field independence | Task 10 exact-raw Azure evidence contract |
| AC-15 | Task 9 repeated local lifecycle | Task 10 explicit-Description Azure evidence contract |

Task 11 owns every local build, audit, version, identity, scope, VSIX-content, bundle-size, clean-tree, and CI release gate. The whole-branch review owns the fresh review and verification gates. Task 10 defines the real Azure evidence contract, but the external gate after Task 11 remains blocked until the user authorizes installation and host mutation.

---

### Task 1: Baseline Characterization and BKU Fixture

**Files:**

- Create: `test/fixtures/bku-template.html`
- Create: `test/fixtures/bku-template.provenance.md`
- Create: `test/fixtures/bku-template.test.ts`
- Create: `test/characterization/config-contract.test.ts`
- Create: `test/characterization/source-contract.test.ts`
- Create: `test/characterization/editor-table-contract.test.ts`
- Create: `test/characterization/manifest-contract.test.ts`
- Create: `test/characterization/host-order-contract.test.ts`
- Create: `docs/acceptance-matrix.md`
- Read: `/Users/gnx/Downloads/Extension_render_problem.docx`
- Read: `docs/superpowers/specs/2026-08-18-rooster-description-editor-rewrite-design.md`

**Interfaces:**

- Consumes: literal HTML text between the first `<html` and matching `</html>` reconstructed from DOCX OOXML text runs.
- Produces: a tracked one-line HTML fixture with one final LF, SHA-256 `0005e3eff97cc3aa39bbb2d90aa5b6f76b4435eb4b679d5ae3e1182b61c24b2a`, byte length `10,423`, six `table` elements, one `style` element, the BKU heading classes, global reset selectors, inline styles, and `@media print`.
- Produces: passing, behavior-first characterization of current config parsing, exact strings and telemetry names, toolbar/menu labels and order, table states, manifest contract, and SDK host-call order before any production replacement.
- Produces: an acceptance matrix listing AC-01 through AC-15 with columns `Legacy baseline`, `Approved intentional hardening`, `Rewrite automated target`, `Harness target`, `Azure target`, and `Status`.

- [ ] **Step 1: Add the red fixture-fidelity test**

Create `test/fixtures/bku-template.test.ts` with literal expectations. The first test must fail because the fixture is absent, not because of a syntax/import error:

```typescript
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const fixturePath = resolve("test/fixtures/bku-template.html");

describe("BKU template fixture", () => {
  it("preserves the recovered DOCX HTML text payload", () => {
    expect(existsSync(fixturePath)).toBe(true);
    const html = readFileSync(fixturePath, "utf8");
    expect(Buffer.byteLength(html)).toBe(10_423);
    expect(createHash("sha256").update(html).digest("hex")).toBe(
      "0005e3eff97cc3aa39bbb2d90aa5b6f76b4435eb4b679d5ae3e1182b61c24b2a"
    );
  });
});
```

- [ ] **Step 2: Run the fixture test and record RED**

Run:

```bash
npm test -- test/fixtures/bku-template.test.ts --reporter=verbose
```

Expected: FAIL at `existsSync(fixturePath)` with `expected false to be true`.

- [ ] **Step 3: Reconstruct the exact payload**

Use this read-only extraction as the oracle, then add the resulting payload with one final LF using `apply_patch`:

```bash
textutil -convert txt -stdout "/Users/gnx/Downloads/Extension_render_problem.docx" |
  perl -0777 -ne 'if (/(<html\b[\s\S]*?<\/html>)/i) { print $1 }'
```

Do not copy narrative text or screenshots into the fixture. Do not claim recovery of original standalone-file metadata.

- [ ] **Step 4: Add structural fixture assertions**

Extend the same test with hand-derived assertions:

```typescript
expect(html.match(/<table\b/gi)).toHaveLength(6);
expect(html.match(/<style\b/gi)).toHaveLength(1);
expect(html).toContain("class=\"green big_heading\"");
expect(html).toContain("table.pdf_table");
expect(html).toContain("border:1px solid black");
expect(html).toContain("@media print");
expect(html).toContain("transition:all 200ms ease-in-out");
```

- [ ] **Step 5: Freeze the current non-fixture behavior before replacement**

Add passing characterization tests without editing production code:

- `config-contract.test.ts` covers all/missing/empty inputs, trim/case rules, debounce parsing, Boolean variants, and the legacy `System.Description` fallback.
- `source-contract.test.ts` asserts the exact seven telemetry names and all ten visible-string templates: `Ready`, `Editing {FieldName} on {WorkItemType}`, `Pending autosync...`, `Autosynced`, `Synced ({time})`, `Reloaded from work item form`, `Autosync failed: {bounded error}`, `Work item unloaded.`, `Rooster editor is not enabled for work item type "{type}".`, and `Failed to initialize Rooster Description control: {bounded error}`. Runtime placeholders are represented by concrete deterministic test values while punctuation and capitalization remain literal.
- `editor-table-contract.test.ts` mounts current components with narrow Rooster boundary fakes. Assert toolbar order `Bold, Italic, Underline, Bullet, Number, Link, Table, Code, Undo, Redo` (and the Code-disabled variant); table sections `Insert, Delete, Merge, Split, Align Cell, Align Table, Shading`; every source-authoritative item label; delete/merge enablement; active alignment/shading; and permanently disabled `Full Width`.
- `manifest-contract.test.ts` reads `vss-extension.json` and asserts publisher/id/version/public/category/target/scope, contribution id/type/target/name/URI/height, exact files, and the five input definitions including required flags and HTML field type.
- `host-order-contract.test.ts` imports the current entry under fresh SDK/service mocks and records the actual legacy order `init → ready → getHost → getExtensionContext → getConfiguration → getService → getContributionId → register → notifyLoadSucceeded` (class-field telemetry initialization currently precedes the controller constructor body). It also freezes the current failure prefix and `notifyLoadFailed` behavior. The acceptance matrix separately records the approved Task 8 target-order hardening to configuration-first metadata capture; no other drift is allowed.

When direct behavior is observable, assert DOM/calls rather than source text. Source-contract inspection is limited to private literal/event-name contracts that cannot yet be reached without rewriting production seams.

- [ ] **Step 6: Run the complete characterization suite before production edits**

```bash
npm test -- test/fixtures/bku-template.test.ts test/characterization/config-contract.test.ts test/characterization/source-contract.test.ts test/characterization/editor-table-contract.test.ts test/characterization/manifest-contract.test.ts test/characterization/host-order-contract.test.ts --reporter=verbose
```

Expected: every characterization test passes against the untouched production implementation; output is pristine. If a claimed current behavior does not pass, correct the characterization to the observed source behavior and record the design-approved target difference in the acceptance matrix—do not change production code in Task 1.

- [ ] **Step 7: Add provenance and acceptance matrix**

The provenance document records DOCX absolute path, extraction rule, payload and tracked-file hashes, byte count, date, six-table/one-style facts, and the limitation that no embedded standalone HTML part existed.

The acceptance matrix contains every AC-01 through AC-15 row and the intentional-hardening list from design §11.1. Baseline status is `characterized` only where the fixture or characterization tests prove it; missing lifecycle/security/browser/Azure evidence is `not yet verified`.

- [ ] **Step 8: Run GREEN and the unchanged baseline**

Run:

```bash
npm test -- test/fixtures/bku-template.test.ts --reporter=verbose
npm test -- --reporter=verbose
./node_modules/.bin/tsc --noEmit
```

Expected: fixture and characterization suites pass; full suite has more than the original 15 passing tests and zero failures; typecheck exits zero.

- [ ] **Step 9: Self-review and commit**

Verify the fixture hash independently with `shasum -a 256`, verify no generated files are tracked, then commit:

```bash
git add test/fixtures/bku-template.html test/fixtures/bku-template.provenance.md test/fixtures/bku-template.test.ts test/characterization docs/acceptance-matrix.md
git commit -m "test: capture BKU template regression fixture"
```

---

### Task 2: Deterministic Build and Test-Harness Foundation

**Files:**

- Modify: `package.json`
- Modify: `webpack.config.js`
- Modify: `tsconfig.json`
- Modify: `.gitignore`
- Modify: `src/test-harness.ts`
- Modify: `test.html`
- Create: `scripts/lib/build-contract.mjs`
- Create: `scripts/clean-generated.mjs`
- Create: `scripts/check-build-outputs.mjs`
- Create: `test/build/buildContract.test.ts`

**Interfaces:**

- Produces scripts `typecheck`, `build`, `build:harness`, and `check:build-outputs`.
- Production entry map is exactly `{ control: src/control/index.ts }`.
- Harness entry map is exactly `{ control: src/control/index.ts, "test-harness": src/test-harness.ts }`.
- `npm run clean` path-safely removes only the repository's generated `dist/` and `artifacts/` directories, rejecting symlink/path-escape targets.
- `npm run build` cleans generated output and leaves exactly `dist/control.js` plus Webpack's observed `dist/control.js.LICENSE.txt`.
- `npm run build:harness` cleans generated output and leaves exactly `dist/control.js` plus `dist/test-harness.js`.
- `tsconfig.json` strictly includes `src/**/*.ts` and `test/**/*.ts`.

- [ ] **Step 1: Record the build RED**

Run before editing:

```bash
npm run build:harness
```

Expected: non-zero exit with `Missing script: "build:harness"`.

- [ ] **Step 2: Write path/output contract RED tests**

Use temporary directories to test the pure helpers behind both CLIs. Assert the cleaner accepts only resolved `dist/` and `artifacts/` children of its supplied repository root, refuses symlink/path escape targets, and leaves unrelated siblings untouched. Assert production and harness exact listings pass while any missing/extra file or nested directory fails.

```bash
npm test -- test/build/buildContract.test.ts --reporter=verbose
```

Expected RED: `scripts/lib/build-contract.mjs` does not exist before implementation.

- [ ] **Step 3: Add mode-aware Webpack configuration**

Export a configuration factory whose `env.harness` flag selects entries:

```javascript
const path = require("path");

module.exports = env => {
  const entries = {
    control: path.resolve(__dirname, "src/control/index.ts")
  };

  if (env && env.harness) {
    entries["test-harness"] = path.resolve(__dirname, "src/test-harness.ts");
  }

  return {
    entry: entries,
    output: {
      filename: "[name].js",
      path: path.resolve(__dirname, "dist")
    },
    resolve: { extensions: [".ts", ".js"] },
    module: {
      rules: [{ test: /\.ts$/, use: "ts-loader", exclude: /node_modules/ }]
    }
  };
};
```

- [ ] **Step 4: Add deterministic scripts and strict test typecheck**

Set these script contracts:

```json
{
  "clean": "node scripts/clean-generated.mjs",
  "typecheck": "tsc --noEmit",
  "build": "npm run clean && webpack --mode production",
  "build:harness": "npm run clean && webpack --mode development --env harness",
  "check:build-outputs": "node scripts/check-build-outputs.mjs",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

Keep existing package/VSIX scripts until Task 11 replaces them. Include test TypeScript in `tsconfig.json` without weakening `strict:true`.

- [ ] **Step 5: Implement the path-safe cleaner and exact output checker**

`scripts/clean-generated.mjs` resolves repository-root `dist/` and `artifacts/`, refuses symlinks or any target outside the root, and removes only those two generated directories. `scripts/check-build-outputs.mjs` accepts `production` or `harness`, recursively lists `dist/`, and requires the exact file set for that mode—unexpected files or subdirectories fail:

```javascript
import { readdirSync } from "node:fs";

const mode = process.argv[2];
const actual = readdirSync("dist", { recursive: true })
  .map(String)
  .sort();
const expected = mode === "production"
  ? ["control.js", "control.js.LICENSE.txt"]
  : mode === "harness"
    ? ["control.js", "test-harness.js"]
    : [];
const valid = expected.length > 0 && JSON.stringify(actual) === JSON.stringify(expected);

if (!valid) {
  process.exitCode = 1;
  console.error("Unexpected build outputs", { mode, expected, actual });
}
```

- [ ] **Step 6: Make the minimal harness entry safe and importable**

Export `mountTestHarness(root: HTMLElement): RoosterHost` from `src/test-harness.ts`, guard the automatic browser mount when `#app` is absent, retain current Turkish sample content, and use the production `RoosterHost` class. Do not build the full fake Azure lifecycle UI yet.

- [ ] **Step 7: Ignore deterministic generated paths**

Add exact ignore entries for `artifacts/`, `.superpowers/`, and current generated paths. Keep `node_modules/`, `dist/`, `*.vsix`, and `.DS_Store` ignored.

- [ ] **Step 8: Run GREEN build contracts**

Run:

```bash
npm run typecheck
npm test -- test/build/buildContract.test.ts --reporter=verbose
npm test -- --reporter=verbose
npm run build
npm run check:build-outputs -- production
npm run build:harness
npm run check:build-outputs -- harness
```

Expected: all commands exit zero. Record production `dist/control.js` byte size and the existing Webpack warning count.

- [ ] **Step 9: Self-review and commit**

```bash
git add package.json webpack.config.js tsconfig.json .gitignore src/test-harness.ts test.html scripts/lib/build-contract.mjs scripts/clean-generated.mjs scripts/check-build-outputs.mjs test/build/buildContract.test.ts
git commit -m "build: restore deterministic control and harness builds"
```

---

### Task 3: Configuration, Work Item Bridge, and Telemetry Boundaries

**Files:**

- Modify: `src/config/defaults.ts`
- Modify: `test/config/defaults.test.ts`
- Modify: `src/bridge/WorkItemBridge.ts`
- Create: `test/bridge/WorkItemBridge.test.ts`
- Modify: `src/telemetry/TelemetryClient.ts`
- Create: `test/telemetry/TelemetryClient.test.ts`

**Interfaces:**

```typescript
export interface ControlConfig {
  readonly fieldName: string;
  readonly fieldNameWasExplicit: boolean;
  readonly enabledWits: readonly string[];
  readonly debounceMs: number;
  readonly enableMarkdownAutoformat: boolean;
  readonly enableCodeBlock: boolean;
}

export type WorkItemFormServiceProvider = () => Promise<IWorkItemFormService>;

export interface TelemetryClientOptions {
  readonly extensionVersion: string;
  readonly hostType: "Services" | "Server" | "Unknown";
  readonly now?: () => Date;
  readonly info?: (...values: unknown[]) => void;
}

export class TelemetryClient {
  constructor(options: TelemetryClientOptions);
  track(
    eventName: TelemetryEventName,
    properties?: Readonly<Record<string, unknown>>
  ): void;
  trackFeature(
    feature: FeatureName,
    properties?: Readonly<Record<string, unknown>>
  ): void;
}
```

- `getControlConfig` retains the default `System.Description` but sets `fieldNameWasExplicit:false` for missing/blank input, trims explicit names, and returns frozen config/array values.
- `WorkItemBridge.create(provider?)` requests the real service by default and accepts a provider seam in tests.
- `WorkItemBridge.hasFieldChanged(args, fieldName)` is available on the instance for the injected lifecycle port; a static compatibility wrapper may delegate to the same implementation during migration.
- Null/undefined field values become empty; `0` and `false` become `"0"` and `"false"`.
- Telemetry retains exactly seven existing event names, console.info sink, fixed metadata, primitive-only copied properties, and forbidden content/error keys. It has no Azure SDK import or eager metadata lookup; Task 8 constructs it only from host/extension metadata captured after `SDK.ready`.

- [ ] **Step 1: Write configuration RED tests**

Add focused tests:

```typescript
expect(getControlConfig({}).fieldNameWasExplicit).toBe(false);
expect(getControlConfig({ witInputs: { FieldName: "   " } }).fieldNameWasExplicit).toBe(false);
expect(
  getControlConfig({ witInputs: { FieldName: " Custom.RoosterContent " } })
).toMatchObject({
  fieldName: "Custom.RoosterContent",
  fieldNameWasExplicit: true
});
expect(Object.isFrozen(getControlConfig({}))).toBe(true);
expect(Object.isFrozen(getControlConfig({}).enabledWits)).toBe(true);
```

Run `npm test -- test/config/defaults.test.ts --reporter=verbose`.

Expected RED: missing `fieldNameWasExplicit` and mutability assertions fail.

- [ ] **Step 2: Implement immutable configuration**

Add the property, freeze a new normalized WIT array and final object, preserve Boolean forms `true/1/yes/on` and `false/0/no/off`, case-insensitive WIT comparison, and invalid/negative debounce fallback `500`.

- [ ] **Step 3: Write WorkItemBridge RED tests**

Use a complete fake service object at the external boundary. Assert:

```typescript
expect(await bridge.getFieldValue("A")).toBe("");
expect(await zeroBridge.getFieldValue("A")).toBe("0");
expect(await falseBridge.getFieldValue("A")).toBe("false");
await bridge.setFieldValue("Custom.RoosterContent", "<p>x</p>");
expect(writeLog).toEqual([["Custom.RoosterContent", "<p>x</p>"]]);
expect(WorkItemBridge.hasFieldChanged(ownArgs, "Custom.RoosterContent")).toBe(true);
expect(WorkItemBridge.hasFieldChanged(inheritedArgs, "Custom.RoosterContent")).toBe(false);
```

Expected RED: current conversion loses `0`/`false` and `create` has no injectable provider.

```bash
npm test -- test/bridge/WorkItemBridge.test.ts --reporter=verbose
```

Expected RED: `0`/`false` conversion and injected-provider assertions fail against the current bridge.

- [ ] **Step 4: Implement the bridge seam**

Keep `IWorkItemFormService` private to this module. Default provider calls `SDK.getService(WorkItemTrackingServiceIds.WorkItemFormService)` after SDK readiness. Do not add a Description convenience path.

- [ ] **Step 5: Write telemetry RED tests**

Instantiate with fixed options and a capturing sink. Assert exact envelope and feature mapping. Pass runtime-invalid properties through `as unknown as`:

```typescript
client.track("autosync_failure", {
  safe: true,
  count: 2,
  objectValue: { secret: "x" },
  error: new Error("stack/content"),
  html: "<p>secret</p>",
  url: "https://secret.example"
} as unknown as Record<string, unknown>);

expect(payload.properties).toEqual({ safe: true, count: 2 });
```

Expected RED: current constructor is unavailable/inflexible and current runtime serializes invalid values.

Also assert importing/constructing `TelemetryClient` never calls `SDK.getHost`, `SDK.getExtensionContext`, or any other SDK method; those calls belong only to Task 8 bootstrap.

```bash
npm test -- test/telemetry/TelemetryClient.test.ts --reporter=verbose
```

Expected RED: direct construction is unavailable and runtime-invalid/content-bearing properties are serialized by the current SDK-coupled implementation.

- [ ] **Step 6: Implement telemetry filtering**

Filter to string/number/boolean primitives and drop keys matching `html`, `css`, `content`, `body`, `value`, `url`, `stack`, `error`, and `selection` case-insensitively. Keep safe keys `wit`, `fieldName`, `isReadOnly`, `isEnabled`, `errorCode`, and `operation`. Never add event names.

- [ ] **Step 7: Run GREEN and broad checks**

```bash
npm test -- test/config/defaults.test.ts test/bridge/WorkItemBridge.test.ts test/telemetry/TelemetryClient.test.ts --reporter=verbose
npm run typecheck
npm test -- --reporter=verbose
```

- [ ] **Step 8: Self-review and commit**

```bash
git add src/config/defaults.ts test/config/defaults.test.ts src/bridge/WorkItemBridge.ts test/bridge/WorkItemBridge.test.ts src/telemetry/TelemetryClient.ts test/telemetry/TelemetryClient.test.ts
git commit -m "feat: harden configuration and host data boundaries"
```

---

### Task 4: Canonical HTML Sanitizer and CSS Isolation

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/bridge/Sanitizer.ts`
- Create: `src/bridge/cssPolicy.ts`
- Create: `src/bridge/htmlCanonicalizer.ts`
- Replace: `test/bridge/Sanitizer.test.ts`
- Mechanically modify: `src/control/RoosterDescriptionControl.ts` (`sanitizeHtml` calls only)

**Interfaces:**

```typescript
export interface HtmlNormalizer {
  normalizeHtml(value: string | null | undefined): string;
}

export class Sanitizer implements HtmlNormalizer {
  normalizeHtml(value: string | null | undefined): string;
}
```

- `normalizeHtml` is the only public sanitizer operation.
- Output is one optional canonical `style` followed by one fresh neutral `div[data-rdx-content-root]`.
- CSS parsing/generation is private behind `cssPolicy.ts`.
- HTML sanitization/root recreation/attribute sorting is private behind `htmlCanonicalizer.ts`.

- [ ] **Step 1: Write root and HTML-security RED tests**

Replace broad current assertions with literal canonical outputs:

```typescript
expect(sanitizer.normalizeHtml("<p>hello</p>")).toBe(
  '<div data-rdx-content-root=""><p>hello</p></div>'
);
```

Add cases for one fresh marker, stripping marker class/id/style/event attributes, nested marker flattening, scripts/events/iframe/object/embed/form/input/button/textarea removal, HTTPS anchor preservation, unsafe URI removal, lexical attribute order, and empty safe fallback.

Run:

```bash
npm test -- test/bridge/Sanitizer.test.ts --reporter=verbose
```

Expected RED: current output has no wrapper and preserves unsafe inline policy/root state.

- [ ] **Step 2: Pin approved dependencies after RED is recorded**

Run:

```bash
npm install --save-exact css-tree@3.2.1 dompurify@3.4.13
npm install --save-dev --save-exact @types/css-tree@3.2.0
```

Verify `npm ls dompurify css-tree @types/css-tree --depth=0` reports exact versions. Do not implement policy yet.

- [ ] **Step 3: Implement detached HTML parsing and neutral root**

Use browser parsing, extract/remove style elements before DOMPurify, run the HTML profile with explicit forbidden tags, reserve/remove all input marker attributes, unwrap marker content, create a fresh marker-only div, sort normal attributes lexicographically, and serialize deterministically.

- [ ] **Step 4: Write stylesheet/selector RED tests**

Use hand-derived literal transformations:

```typescript
expect(normalize("<style>table{border:1px solid black}</style><table></table>"))
  .toContain("[data-rdx-content-root] table{border:1px solid black}");
expect(normalize("<style>body > table{width:100%}</style><table></table>"))
  .toContain("[data-rdx-content-root]>table{width:100%}");
expect(normalize("<style>html body .x{color:red}</style><p class=x>x</p>"))
  .toContain("[data-rdx-content-root] .x{color:red}");
```

Add mixed selector branches, exact existing marker, rejected late/value marker, topology-dependent root pseudo, `:host`/`::part`/`:global`, malformed branch, and repeat scoping.

Expected RED: current regex retains global selectors.

```bash
npm test -- test/bridge/Sanitizer.test.ts --reporter=verbose
```

Expected RED: global `table` and document-root selectors remain unscoped and rejected selector branches survive.

- [ ] **Step 5: Implement selector AST policy**

Parse selector lists with css-tree. Transform branches independently exactly as Design Section 7.4 specifies. Reject unknown/Raw nodes. Preserve source branch/rule order. Never fall back to raw CSS.

- [ ] **Step 6: Write declaration/at-rule/inline RED tests**

Cover the explicit allow-list and value restrictions:

- safe BKU typography, border, widths, spacing, colors, background color, table, flex/list/transition values;
- `position:relative` accepted; absolute/fixed/sticky rejected;
- color-only `background` accepted; every `url()` rejected;
- custom properties/`var()`/`expression()`/JavaScript/VBScript/`behavior`/`-moz-binding` rejected;
- inline declarations use the identical policy;
- only exact `@media print` survives;
- safe sibling rules survive when a bad sibling is dropped;
- aggregate 100,001-character split styles drop all stylesheet CSS;
- `!important` and declaration/rule order remain.

Expected RED: current policy is regex-only, per-block, and leaves inline style uncontrolled.

```bash
npm test -- test/bridge/Sanitizer.test.ts --reporter=verbose
```

Expected RED: the split aggregate-cap, safe-sibling, inline declaration, and property-specific assertions fail against the current regex policy.

- [ ] **Step 7: Implement declaration and at-rule policy**

Require explicit property allow-list, `cssTree.lexer.matchProperty` success, AST walk with forbidden nodes/functions, and property-specific checks. Generate canonical CSS. Remove empty inline `style` attributes.

- [ ] **Step 8: Add idempotency, shell-isolation, and BKU golden tests**

Assert:

```typescript
const once = sanitizer.normalizeHtml(input);
expect(sanitizer.normalizeHtml(once)).toBe(once);
```

For the BKU fixture, assert six tables, heading classes, border/font/size/weight/color rules, safe print rule, only rooted selectors, and no selector capable of matching `.rdx-toolbar`, `.rdx-status`, `.rdx-message`, or `.rdx-context-menu`.

```bash
npm test -- test/bridge/Sanitizer.test.ts --reporter=verbose
```

Expected RED: before the final canonical fixes, at least the repeat-normalization or full BKU/shell-isolation assertion fails for a named byte/selector difference; record it before the fix. If all assertions already pass from Steps 3/5/7, do not manufacture a failure—treat this as a new passing characterization and make no additional implementation change.

- [ ] **Step 9: Migrate current consumers and run GREEN**

Replace controller `sanitizeHtml` calls with `normalizeHtml` so the branch builds; do not perform the lifecycle rewrite. Remove the old public method.

Run:

```bash
npm test -- test/bridge/Sanitizer.test.ts --reporter=verbose
npm run typecheck
npm test -- --reporter=verbose
npm run build
npm audit --omit=dev
wc -c < dist/control.js
```

Expected: all tests/typecheck/build pass; production audit has zero unapproved vulnerabilities; bundle growth is recorded against `537,439` bytes.

- [ ] **Step 10: Self-review and commit**

```bash
git add package.json package-lock.json src/bridge/Sanitizer.ts src/bridge/cssPolicy.ts src/bridge/htmlCanonicalizer.ts test/bridge/Sanitizer.test.ts src/control/RoosterDescriptionControl.ts
git commit -m "feat: canonicalize and scope rich HTML"
```

This task requires two independent reviewers after its review package is generated.

---

### Task 5: Failure-Safe SyncEngine State Machine

**Files:**

- Modify: `src/bridge/SyncEngine.ts`
- Replace: `test/bridge/SyncEngine.test.ts`

**Interfaces:**

```typescript
export interface SyncEngineOptions {
  readonly debounceMs: number;
  readonly normalizer: HtmlNormalizer;
  readonly writeValue: (value: string) => Promise<void>;
  readonly onWriteSuccess?: (value: string) => void;
  readonly onError?: (error: unknown) => void;
}

export class SyncEngine {
  schedule(rawValue: string): void;
  flush(): Promise<void>;
  alignToHost(rawValue: string): void;
  isEcho(rawValue: string): boolean;
  dispose(): void;
}
```

Internal state is `disposed`, timer, latest queued canonical value, `lastSuccessfulValue`, current-generation `inFlight` candidate, recovered `tail`, externally rejecting `activeOperation`, and generation token.

- [ ] **Step 1: Write controlled-promise RED tests**

Add a local `deferred<T>()` test helper and fake timers. First cases:

- first rejected write does not suppress a second schedule of the same value;
- `flush()` rejects with the write failure and calls `onError` exactly once;
- in-flight value is echo before resolve and ceases to be echo after reject.

```bash
npm test -- test/bridge/SyncEngine.test.ts --reporter=verbose
```

Expected RED: current engine advances last-written before success and swallows the rejection observed by `flush()`.

- [ ] **Step 2: Implement recovered serialization**

Implement a private drain/enqueue operation:

```typescript
const operation = this.tail.then(async () => {
  if (this.disposed || operationGeneration !== this.generation) return;
  if (value === this.lastSuccessfulValue) return;
  this.inFlight = { value, generation: operationGeneration };
  await this.writeValue(value);
  if (operationGeneration === this.generation && !this.disposed) {
    this.lastSuccessfulValue = value;
    this.onWriteSuccess?.(value);
  }
});

this.activeOperation = operation;
this.tail = operation.catch(() => undefined);
```

The actual implementation must clear the matching in-flight candidate in success/failure cleanup and call current-generation `onError` once before rethrowing.

- [ ] **Step 3: Add debounce/serialization/flush RED tests**

Cover single/rapid changes, timer reset, latest value only, controlled A-then-B serial ordering, duplicate canonical suppression, flush before debounce, flush while A is in flight and B queued, and timer-path terminal catch with later recovery.

Expected failures must name lost error/ordering behavior, not timer setup errors.

```bash
npm test -- test/bridge/SyncEngine.test.ts --reporter=verbose
```

Expected RED: queued/in-flight `flush()` failure propagation and later timer recovery assertions fail against the current swallowed chain.

- [ ] **Step 4: Implement timer and flush semantics**

Timer expiry calls drain and terminates rejection with `catch(() => undefined)` after `onError`. Explicit `flush` clears the timer, enqueues the pending latest value, snapshots the relevant operation, and awaits it, including predecessors already serialized before it.

- [ ] **Step 5: Add host alignment/disposal RED tests**

Cover:

- `alignToHost(B)` cancels queued A/timer and establishes B;
- dispose before timer prevents write;
- dispose during an already-entered write allows physical completion but suppresses success/error callbacks;
- no operation scheduled after dispose;
- host-equivalent canonical serialization is echo while text/class/style loss is external.

```bash
npm test -- test/bridge/SyncEngine.test.ts --reporter=verbose
```

Expected RED: current `markLastWritten` does not cancel queued work or advance a disposal/alignment generation, so queued-A and stale-callback assertions fail.

- [ ] **Step 6: Implement alignment and disposal**

Advance generation on align/dispose, clear timer/queue, set normalized host baseline on align, and do not claim cancellation of an entered host write.

- [ ] **Step 7: Run GREEN and broad checks**

```bash
npm test -- test/bridge/SyncEngine.test.ts --reporter=verbose
npm run typecheck
npm test -- --reporter=verbose
npm run build
```

- [ ] **Step 8: Self-review and commit**

```bash
git add src/bridge/SyncEngine.ts test/bridge/SyncEngine.test.ts
git commit -m "feat: serialize canonical autosync lifecycle"
```

The task reviewer must emit separate `SPECIFICATION COMPLIANCE` and `CODE QUALITY` verdicts.

---

### Task 6: Logical Table Selection and Accessible Context Menu

**Files:**

- Modify: `src/control/tableSelection.ts`
- Extend: `test/control/tableSelection.test.ts`
- Modify: `src/control/TableContextMenu.ts`
- Create: `test/control/TableContextMenu.test.ts`
- Modify: `static/control.css`

**Interfaces:**

```typescript
export interface TableSelectionSnapshot {
  readonly table: HTMLTableElement;
  readonly cell: HTMLTableCellElement;
  readonly rowCount: number;
  readonly columnCount: number;
  readonly selectedRowCount: number;
  readonly selectedColumnCount: number;
  readonly selectedCells: readonly HTMLTableCellElement[];
  readonly hasTableSelection: boolean;
  readonly hasMultiCellSelection: boolean;
  readonly cellHorizontalAlignment: TableCellHorizontalAlignment;
  readonly cellVerticalAlignment: TableCellVerticalAlignment;
  readonly tableAlignment: TableAlignment;
  readonly cellShadeColor: string | null;
}
```

`hasMultiCellSelection` is true only when at least two distinct physical cells form a valid logical rectangle without slicing a merged cell.

The exact menu labels remain source-authoritative: Row Above, Row Below, Column Left, Column Right, Delete Row, Delete Column, Delete Table, Merge Cells, Split Columns, Split Rows, Left/Center/Right, Top/Middle/Bottom, Full Width, None/Yellow/Green/Blue/Gray.

- [ ] **Step 1: Write logical-grid RED tests**

Add cases for rowspan, colspan, mixed spans, reversed selection coordinates, a single physical cell spanning 2 by 2 logical coordinates, a valid multi-cell rectangle, and a rectangle slicing a merged cell.

```bash
npm test -- test/control/tableSelection.test.ts --reporter=verbose
```

Expected RED: the single merged-cell assertion expects `hasMultiCellSelection` false but receives true from the current `selectedRowCount * selectedColumnCount` logic.

- [ ] **Step 2: Implement distinct-cell rectangularity**

Build the logical grid once per snapshot, collect unique cells in the selected rectangle, locate every logical coordinate occupied by each selected cell, and require every occupied coordinate to lie within the selected bounds.

- [ ] **Step 3: Write menu state/action RED tests**

Using a boundary fake for `IEditor`, assert:

- row/column deletion disabled at one row/column;
- merge enabled only for valid distinct rectangle;
- Full Width always disabled;
- active alignment and shading classes/ARIA states;
- operations call `editTable` and shading calls `setTableCellShade`;
- viewport clamping uses a 12-pixel margin;
- command failure logs controlled operation/error code without raw Error and leaves content/status callback untouched.

```bash
npm test -- test/control/TableContextMenu.test.ts --reporter=verbose
```

Expected RED: the current menu logs the raw error object and lacks the required active/disabled ARIA state, so the bounded-diagnostic and state assertions fail.

- [ ] **Step 4: Implement state and controlled diagnostics**

Keep Rooster `editTable`/`setTableCellShade` calls. Replace raw error logging with bounded primitive operation/error-name fields. Preserve one `onContentChanged` and feature callback only after successful commands.

- [ ] **Step 5: Write accessibility/focus RED tests**

Assert `role=menu`, `role=menuitem`, first enabled focus, Arrow Up/Down wrap, Home/End, Enter/Space activation, Escape/outside/resize/blur close, origin focus restoration if connected, and exact listener removal/idempotent dispose.

Expected RED: current menu only supports pointer and Escape, does not focus/restore, and has no roles.

```bash
npm test -- test/control/TableContextMenu.test.ts --reporter=verbose
```

Expected RED: `role="menu"`/`role="menuitem"`, first-focus, keyboard traversal, focus restoration, and listener-disposal assertions fail against the current pointer-only menu.

- [ ] **Step 6: Implement keyboard and lifecycle semantics**

Capture the active element on open, maintain enabled action ordering, prevent default for handled keys, restore focus once on close, and remove every global listener on dispose. Preserve pointer behavior and viewport clamping.

- [ ] **Step 7: Run GREEN and broad checks**

```bash
npm test -- test/control/tableSelection.test.ts test/control/TableContextMenu.test.ts --reporter=verbose
npm run typecheck
npm test -- --reporter=verbose
```

- [ ] **Step 8: Self-review and commit**

```bash
git add src/control/tableSelection.ts test/control/tableSelection.test.ts src/control/TableContextMenu.ts test/control/TableContextMenu.test.ts static/control.css
git commit -m "feat: make table menu logical and keyboard accessible"
```

The reviewer must emit independent specification and quality verdicts.

---

### Task 7: RoosterHost Integration and Code-Block Contract

**Files:**

- Modify: `src/control/RoosterHost.ts`
- Modify only if tests prove necessary: `src/control/toggleCodeBlock.ts`
- Create: `test/control/RoosterHost.test.ts`
- Create: `test/control/toggleCodeBlock.test.ts`
- Modify: `static/control.css`

**Interfaces:**

```typescript
export interface RoosterHostOptions {
  readonly enableMarkdownAutoformat: boolean;
  readonly enableCodeBlock: boolean;
  readonly onFeatureUsed?: (feature: "table" | "markdown" | "codeblock") => void;
}

export interface EditorHost {
  onChange(listener: (nextHtml: string) => void): () => void;
  setHtml(nextHtml: string): void;
  getHtml(): string;
  setReadOnly(readOnly: boolean): void;
  setStatus(text: string): void;
  dispose(): void;
}
```

`RoosterHost` implements `EditorHost`. One internal `emitChange` path supplies the latest complete canonical fragment to listeners.

- [ ] **Step 1: Write toolbar/semantic RED tests**

Mount a real `RoosterHost` under jsdom and assert exact button order:

```typescript
expect(buttons.map(button => button.textContent)).toEqual([
  "Bold", "Italic", "Underline", "Bullet", "Number",
  "Link", "Table", "Code", "Undo", "Redo"
]);
```

Assert optional Code absence, toolbar `role=toolbar`/label, editor aria-label, status `role=status`/`aria-live=polite`, text buttons, and initial `Ready`.

Expected RED: current semantics are absent.

```bash
npm test -- test/control/RoosterHost.test.ts --reporter=verbose
```

Expected RED: toolbar/editor/status semantic attribute assertions fail while the literal toolbar-order assertion characterizes the current order.

- [ ] **Step 2: Implement exported ports and semantics**

Export the interfaces, add semantic attributes without changing layout/classes/order, and keep status text via `textContent`.

- [ ] **Step 3: Write change-path and prompt RED tests**

Cover input, keyup, cut, delayed paste, toolbar action, table insertion, context-menu callback, and code shortcut. Assert latest `innerHTML` reaches listeners once per actual operation. For links:

```typescript
vi.spyOn(window, "prompt").mockReturnValue("   ");
linkButton.click();
expect(changeListener).not.toHaveBeenCalled();
```

Also assert cancel/empty no-op, trim non-empty URL, Table inserts 3 by 3, and Markdown feature telemetry only for Markdown-like pasted plain text when enabled.

```bash
npm test -- test/control/RoosterHost.test.ts --reporter=verbose
```

Expected RED: clicking Link after a whitespace-only prompt currently calls `insertLink("")` and the generic button wrapper emits a change; the no-op assertions fail.

- [ ] **Step 4: Implement actual-change handling**

Make link handling return whether it changed content, so the generic button wrapper does not emit on cancel/trimmed-empty. Preserve native `window.prompt("Link URL")`. Keep all other actions routed through one emitter.

- [ ] **Step 5: Write undo/redo/disposal RED tests**

Assert snapshots are used, paste emits after DOM update, disposer removes DOM/table/global listeners, repeated mount/dispose does not duplicate events, and listener unsubscribe is idempotent.

```bash
npm test -- test/control/RoosterHost.test.ts --reporter=verbose
```

Expected RED: the new disposal boundary assertions fail because the current host does not expose the injectable editor/menu seams needed to prove listener ownership and idempotence.

- [ ] **Step 6: Add code-block dependency contract tests**

Exercise `toggleCodeBlock` through the installed RoosterJS 9.45.2 content-model boundary. Assert focus, API name `toggleCodeBlock`, paragraph split/wrap into `pre` with Consolas, repeated toggle unwrap, and Ctrl/Cmd+Shift+8 behavior. Do not replace the two private deep imports unless the test proves the installed API changed.

```bash
npm test -- test/control/toggleCodeBlock.test.ts --reporter=verbose
```

Expected characterization: PASS against the pinned 9.45.2 helpers. This is a dependency guard, not permission to manufacture a RED; do not edit `toggleCodeBlock.ts` unless a separately named required behavior fails, and record that genuine failing assertion before any fix.

- [ ] **Step 7: Run GREEN and broad checks**

```bash
npm test -- test/control/RoosterHost.test.ts test/control/toggleCodeBlock.test.ts --reporter=verbose
npm run typecheck
npm test -- --reporter=verbose
npm run build
```

- [ ] **Step 8: Self-review and commit**

```bash
git add src/control/RoosterHost.ts src/control/toggleCodeBlock.ts test/control/RoosterHost.test.ts test/control/toggleCodeBlock.test.ts static/control.css
git commit -m "feat: integrate accessible Rooster editor host"
```

---

### Task 8: Azure SDK Bootstrap and Work Item Lifecycle Controller

**Files:**

- Modify: `src/control/index.ts`
- Create: `src/control/bootstrap.ts`
- Rewrite: `src/control/RoosterDescriptionControl.ts`
- Create: `src/control/ReadOnlyView.ts`
- Create: `src/control/errorFormatting.ts`
- Create: `test/control/errorFormatting.test.ts`
- Create: `test/control/index.test.ts`
- Create: `test/control/RoosterDescriptionControl.test.ts`

**Interfaces:**

```typescript
export interface WorkItemPort {
  getFieldValue(fieldName: string): Promise<string>;
  setFieldValue(fieldName: string, value: string): Promise<void>;
  getWorkItemType(): Promise<string>;
  hasFieldChanged(args: IWorkItemFieldChangedArgs, fieldName: string): boolean;
}

export interface SyncPort {
  schedule(rawValue: string): void;
  flush(): Promise<void>;
  alignToHost(rawValue: string): void;
  isEcho(rawValue: string): boolean;
  dispose(): void;
}

export interface ReadOnlyView {
  setHtml(nextHtml: string): void;
  setStatus(text: string): void;
  dispose(): void;
}

export interface ControllerDependencies {
  readonly bridge: WorkItemPort;
  readonly normalizer: HtmlNormalizer;
  readonly telemetry: TelemetryClient;
  readonly createEditor: (root: HTMLElement, options: RoosterHostOptions) => EditorHost;
  readonly createReadOnlyView: (root: HTMLElement) => ReadOnlyView;
  readonly createSync: (options: SyncEngineOptions) => SyncPort;
  readonly now: () => Date;
}
```

The controller receives immutable config and dependencies. The read-only view renders normalized preview HTML only through `setHtml`, uses `textContent` for status/messages, and is independently disposable. `bootstrap.ts` owns the testable SDK sequence and receives an SDK adapter plus a lazy telemetry factory that accepts already-captured extension/host metadata. `index.ts` is the production-only composition entry that invokes it once; importing `bootstrap.ts` in tests has no automatic SDK side effect.

- [ ] **Step 1: Write bounded-error RED tests**

`formatPublicError(error, fallback)` returns `Error.message` only after removing control/newline characters and capping at 200 characters; unknown values return the stable fallback. It never returns stack/JSON/HTML objects.

```bash
npm test -- test/control/errorFormatting.test.ts --reporter=verbose
```

Expected RED: the formatter module does not exist, so the focused test fails to resolve it before implementation.

- [ ] **Step 2: Implement the error formatter**

Use it for bootstrap text, lifecycle fatal messages, autosync status, and controlled console warnings. Rendering uses `textContent` except normalized HTML content views.

- [ ] **Step 3: Write bootstrap-order RED tests**

With a complete SDK adapter fake around `bootstrap.ts`, assert:

```text
init({ loaded:false, applyTheme:true })
ready
resolve #app
getConfiguration
getHost
getExtensionContext
validate explicit FieldName
bridge provider
lazy telemetry factory(captured extension/host metadata)
controller
register(current contribution ID)
notifyLoadSucceeded
```

Missing root or blank/missing raw FieldName must set bounded safe root text when possible, call `notifyLoadFailed`, and never request bridge/register/succeed.

Expected RED: current code acquires bridge/controller without explicit-field validation and is not injectable.

```bash
npm test -- test/control/index.test.ts --reporter=verbose
```

Expected RED: current bootstrap is an eager entry-module side effect, metadata is read inside `TelemetryClient.create`, and the asserted adapter order/failure short-circuit cannot be satisfied.

- [ ] **Step 4: Implement the SDK composition root**

After `SDK.ready` and root resolution, acquire configuration, host metadata, and extension metadata in the asserted order. Validate `fieldNameWasExplicit` before `WorkItemBridge.create`. Construct `TelemetryClient` lazily from the captured metadata; neither its import nor constructor may call SDK methods. No Work Item service is requested before readiness/validation. Only pre-success failures call `notifyLoadFailed`. Keep `index.ts` to imports plus one `void bootstrap(createProductionBootstrapDependencies())` invocation.

- [ ] **Step 5: Write onLoaded branch RED tests**

Using real config/normalizer plus fakes at Azure/editor boundaries, assert:

- unsupported WIT: informational message only, no target read/editor/sync/write;
- read-only: one target read and normalized preview, no editor/sync/write, `readonly_rendered`;
- editable: target read, normalized editor, SyncEngine aligned, exact `Editing {FieldName} on {WIT}`;
- empty value;
- Work Item type/initial field read failure: post-bootstrap fatal text, no partial editor, no `notifyLoadFailed` path.

```bash
npm test -- test/control/RoosterDescriptionControl.test.ts --reporter=verbose
```

Expected RED: current controller constructs concrete dependencies, performs a target read for unsupported WIT paths, and has no injected read-only view whose render/disposal calls can be asserted.

- [ ] **Step 6: Implement load generation and branch ownership**

Every async lifecycle method captures a generation. A newer load/unload prevents stale UI/status/callback/enqueue. Dispose the previous subscription/sync/host before creating the next generation.

- [ ] **Step 7: Write change/save/reload RED tests**

Cover target/non-target change, in-flight/successful echo, real external change, read-only update, save with pending/in-flight value, failed flush retaining `Autosync failed`, refresh/reset host alignment, and exact statuses `Autosynced`, `Synced ({time})`, `Reloaded from work item form`.

```bash
npm test -- test/control/RoosterDescriptionControl.test.ts --reporter=verbose
```

Expected RED: current save path reports `Synced` after a swallowed write failure and lacks the injected generation/sync seams required by the target/non-target and alignment assertions.

- [ ] **Step 8: Implement event coordination**

Filter changed fields against immutable `config.fieldName` before host reads. On success callback emit autosync telemetry/status only for current generation. `onSaved` catches flush failure and never overwrites failure status. Refresh/reset normalize, update, align, then status.

- [ ] **Step 9: Write unload/reload/error/telemetry RED tests**

Assert unsubscribe-before-dispose, sync/editor/menu resources disposed once, queued work prevented, entered host write documented as non-cancellable but stale callbacks suppressed, state reset, `Work item unloaded.`, load-again clean, exact seven telemetry events/properties, no user content.

```bash
npm test -- test/control/RoosterDescriptionControl.test.ts --reporter=verbose
```

Expected RED: current lifecycle has no generation guard or independently disposable read-only view, so stale callbacks/resource-order assertions fail; current telemetry construction/filtering cannot satisfy the content-exclusion assertions.

- [ ] **Step 10: Implement disposal and controlled diagnostics**

Table/sanitizer/read diagnostics remain bounded console warnings and do not invent telemetry names. Later read failures preserve the last valid UI.

- [ ] **Step 11: Run GREEN and broad checks**

```bash
npm test -- test/control/errorFormatting.test.ts test/control/index.test.ts test/control/RoosterDescriptionControl.test.ts --reporter=verbose
npm run typecheck
npm test -- --reporter=verbose
npm run build
```

- [ ] **Step 12: Self-review and commit**

```bash
git add src/control/index.ts src/control/bootstrap.ts src/control/RoosterDescriptionControl.ts src/control/ReadOnlyView.ts src/control/errorFormatting.ts test/control/errorFormatting.test.ts test/control/index.test.ts test/control/RoosterDescriptionControl.test.ts
git commit -m "feat: enforce configured-field lifecycle isolation"
```

This task requires two independent reviewers after its review package is generated.

---

### Task 9: Field-Independence Integration and Full Local Harness

**Files:**

- Create: `test/support/FakeWorkItemHost.ts`
- Create: `test/integration/field-independence.test.ts`
- Create: `test/integration/lifecycle.test.ts`
- Create: `test/integration/harness.test.ts`
- Rewrite: `src/test-harness.ts`
- Modify: `test.html`
- Modify: `static/control.css`
- Create: `docs/regression/local-harness.md`
- Create: `docs/regression/local-harness/editable-bku.png`
- Create: `docs/regression/local-harness/read-only.png`
- Create: `docs/regression/local-harness/unsupported-wit.png`
- Create: `docs/regression/local-harness/table-menu-keyboard.png`
- Create: `docs/regression/local-harness/chrome-isolation.png`
- Update: `docs/acceptance-matrix.md`

**Interfaces:**

`FakeWorkItemHost` owns a complete field map, read log, write log, read-only/WIT state, changed-field/save/refresh/reset/unload/reload simulation, own-property `hasFieldChanged` filtering, and raw-value/hash access. It implements the controller's Work Item port without bypassing controller logic.

The browser harness uses production `ControlConfig`, `Sanitizer`, `SyncEngine`, `RoosterHost`, and `RoosterDescriptionControl` with this fake host.

- [ ] **Step 1: Write custom-field independence RED integration**

Seed `System.Description` with the exact BKU fixture and `Custom.RoosterContent` empty. Configure explicit custom field, load editable SRS, enter `s` through the editor change path, pass debounce, save, refresh, unload/reopen.

Assert:

```typescript
expect(host.writes.filter(write => write.fieldName === "System.Description")).toEqual([]);
expect(host.getRawField("System.Description")).toBe(originalDescription);
expect(host.sha256("System.Description")).toBe(originalDescriptionHash);
expect(host.getRawField("Custom.RoosterContent")).toContain("s");
```

Expected RED: integration support/harness is absent; any accidental configured-field drift fails exact raw equality.

```bash
npm test -- test/integration/field-independence.test.ts --reporter=verbose
```

Expected RED: the fake host/integration module is absent, so the focused test fails before any integration implementation exists.

- [ ] **Step 2: Implement FakeWorkItemHost and pass independence**

Keep the fake at the external host boundary. Do not reimplement sanitizer/sync logic inside it. Its event arguments mirror documented Azure Work Item callback shapes.

- [ ] **Step 3: Add lifecycle integration RED scenarios**

Cover editable, read-only, unsupported WIT, target/non-target changes, immediate and delayed echo, save flush, write failure then next success, refresh/reset, unload/reload, stale async load, and explicit `FieldName=System.Description` canonical stability.

```bash
npm test -- test/integration/field-independence.test.ts test/integration/lifecycle.test.ts --reporter=verbose
```

Expected RED: the new lifecycle scenarios fail at missing fake-host capabilities or at a concrete controller contract assertion; record the first behavior failure before adding that capability.

- [ ] **Step 4: Route production defects back to their canonical owner**

Task 9 may change only the files listed above. If an integration test exposes a defect in sanitizer, sync, table, host, or lifecycle production code, stop Task 9 with the exact failing command/assertion. The controller resumes that earlier task's original implementer for a scoped TDD fix commit, generates a fix-only review package, obtains the required re-review verdict, and then resumes Task 9. Never weaken literal assertions, fake away real controller/normalizer/sync behavior, or leave a production fix unstaged outside Task 9's review package.

- [ ] **Step 5: Write harness DOM RED test**

Import `mountTestHarness` in jsdom and assert controls for:

- FieldName, WIT, editable/read-only;
- Load BKU, field change, save, refresh, reset, unload, reload;
- separate visible custom and Description raw/hash values;
- visible read/write log;
- narrow-width preview;
- custom edit leaves Description panel/hash unchanged.

```bash
npm test -- test/integration/harness.test.ts --reporter=verbose
```

Expected RED: the current minimal harness has none of the lifecycle controls, separate raw/hash panels, or fake-host log required by the assertions.

- [ ] **Step 6: Implement the full harness**

Use production modules and the fake host. Keep automatic mount in browser only. Do not import Azure SDK into `test-harness.js` and do not alter `static/control.html`.

- [ ] **Step 7: Verify harness and production isolation**

```bash
npm test -- test/integration/field-independence.test.ts test/integration/lifecycle.test.ts --reporter=verbose
npm run typecheck
npm test -- --reporter=verbose
npm run build:harness
npm run check:build-outputs -- harness
npm run build
npm run check:build-outputs -- production
```

- [ ] **Step 8: Execute the real-browser local harness evidence gate**

After the harness build, serve the repository only on loopback (for example `python3 -m http.server 4173 --bind 127.0.0.1`) and use the in-app browser controller against `http://127.0.0.1:4173/test.html`. Record the exact HEAD/build command/browser timestamp in `docs/regression/local-harness.md`, then execute—not merely describe—these scenarios:

- AC-01 editable load/edit/save/refresh/reopen, with mock read/write log and separate custom/Description hashes visible;
- AC-02 unsupported WIT, proving no field read/editor/sync/write in the visible log;
- AC-03 read-only preview, proving no editor/sync/write;
- AC-04 BKU fixture with six tables and heading/border/color preservation;
- AC-09 open the table menu, traverse and activate via keyboard, close it, and verify focus restoration;
- AC-13/AC-14 inspect computed toolbar/status/message/menu styles before and after loading BKU global resets, and prove every retained template selector is rooted at `[data-rdx-content-root]` while chrome styles remain equal.

Capture the five named screenshots in this task's file list and paste relevant computed-style values, focus target, table count, and mock-host log/hash assertions into the report. Any visual, focus, console, or chrome-isolation mismatch fails Task 9 and is routed through Step 4. Stop the loopback server after capture.

- [ ] **Step 9: Update acceptance matrix**

Mark automated and local-browser AC rows passed only where fresh test/browser evidence proves them. Keep Azure rows pending.

- [ ] **Step 10: Self-review and commit**

```bash
git add test/support/FakeWorkItemHost.ts test/integration/field-independence.test.ts test/integration/lifecycle.test.ts test/integration/harness.test.ts src/test-harness.ts test.html static/control.css docs/regression/local-harness.md docs/regression/local-harness docs/acceptance-matrix.md
git commit -m "test: prove custom-field Description independence"
```

---

### Task 10: Azure DevOps Regression Evidence Contract and Local Dry Run

**Files:**

- Create: `scripts/lib/regression-evidence.mjs`
- Create: `scripts/verify-regression-evidence.mjs`
- Create: `test/release/regressionEvidence.test.ts`
- Create: `docs/regression/azure-devops-regression.md`
- Create: `docs/regression/evidence/.gitkeep`
- Update: `docs/acceptance-matrix.md`

**Evidence JSON shape (implemented in JavaScript; shown TypeScript-style for clarity):**

```typescript
interface AzureRegressionEvidenceCommon {
  readonly extensionVersion: "0.1.21";
  readonly evidenceKind: "local-dry-run" | "azure-host";
  readonly scenario: "custom-field" | "explicit-system-description";
  readonly beforeRawPath: string;
  readonly beforeRawSha256: string;
  readonly beforeTableCount: number;
  readonly afterTableCount: number;
  readonly headingStyleMatch: boolean;
  readonly borderStyleMatch: boolean;
  readonly colorStyleMatch: boolean;
  readonly domStructureMatch: boolean;
  readonly descriptionWriteCount: number;
  readonly targetWriteCount: number;
  readonly consoleErrors: readonly string[];
  readonly beforeScreenshot: string;
  readonly afterScreenshot: string;
}

export interface CustomFieldAzureEvidence extends AzureRegressionEvidenceCommon {
  readonly scenario: "custom-field";
  readonly afterRawPath: string;
  readonly afterRawSha256: string;
}

export interface ExplicitDescriptionAzureEvidence extends AzureRegressionEvidenceCommon {
  readonly scenario: "explicit-system-description";
  readonly afterSaveRawPath: string;
  readonly afterRefreshRawPath: string;
  readonly afterReopenRawPath: string;
  readonly afterSaveRawSha256: string;
  readonly afterRefreshRawSha256: string;
  readonly afterReopenRawSha256: string;
  readonly canonicalRootAfterSave: true;
  readonly canonicalRootAfterReopen: true;
  readonly allStyleSelectorsScoped: true;
}

export type AzureRegressionEvidence =
  | CustomFieldAzureEvidence
  | ExplicitDescriptionAzureEvidence;
```

The declared hash fields are never trusted. The verifier reads the referenced raw capture files as bytes and recomputes every SHA-256. The custom-field scenario passes only when before/after byte buffers are exactly equal, recomputed hashes match, six tables remain before/after, all visual flags are true, Description writes are zero, target writes are at least one, console errors are zero, and screenshot files exist. The explicit Description scenario parses the saved/refresh/reopened captures, requires those three canonical byte buffers to be identical, requires exactly one top-level neutral `data-rdx-content-root` after save and reopen, parses every retained style rule and rejects any selector branch not rooted at that marker, and requires the same visual/table/console evidence. A normalized hash can be supplemental only; it is never accepted for custom-field equality.

- [ ] **Step 1: Write verifier RED tests**

Create literal passing and failing evidence objects plus controlled temporary raw-capture/screenshot files in tests. Assert the custom-field case fails for changed bytes even when submitted hashes are equal, incorrect recomputed hash, visual flag, table count, Description write, console error, or missing capture/screenshot. Assert canonical comparison is never accepted as a substitute in the custom-field case. For explicit Description, assert failures for save/refresh/reopen byte drift, missing or value-bearing/nested root, root stripped after reopen, any unscoped selector branch, visual/DOM mismatch, or missing capture.

Expected RED: evidence validator does not exist.

```bash
npm test -- test/release/regressionEvidence.test.ts --reporter=verbose
```

Expected RED: the evidence module cannot be resolved before implementation.

- [ ] **Step 2: Implement pure evidence validation**

Return a structured list of failures; the CLI reads one JSON path, reads and hashes every referenced raw file, parses explicit-Description DOM/CSS, checks screenshots, prints each failure, and exits non-zero when any exists. It labels `local-dry-run` conspicuously and supports `--require-azure-host`, which rejects synthetic evidence for the external release gate. Do not contact Azure or fabricate evidence.

- [ ] **Step 3: Write the authorized-run runbook**

Specify:

1. private test organization/collection and explicit installation approval;
2. `FieldName=Custom.RoosterContent` plus standard System.Description;
3. exact BKU fixture and pre-capture raw string/SHA, DOM/table/style/screenshot/console;
4. type `s` only in custom field, wait debounce, save, refresh, close/reopen;
5. post-capture and exact custom-field pass rule;
6. separate explicit-System.Description capture after save, refresh, and reopen, with canonical byte stability, neutral root-marker preservation, and every style selector scoped;
7. JSON evidence creation and verifier command;
8. any difference is failure; missing raw access blocks release.

- [ ] **Step 4: Run local dry-run RED/GREEN**

Run the verifier against a deliberate failing fixture and require non-zero, then against complete local synthetic passing fixtures for both scenarios and require zero. Label synthetic evidence `local-dry-run`; also prove `--require-azure-host` rejects it, and never mark Azure verification passed.

- [ ] **Step 5: Update acceptance matrix honestly**

Mark evidence tooling/local dry run complete. Keep real Azure AC/regression rows `pending external approval and execution`.

- [ ] **Step 6: Run GREEN and commit**

```bash
npm test -- test/release/regressionEvidence.test.ts --reporter=verbose
npm run typecheck
npm test -- --reporter=verbose
git add scripts/lib/regression-evidence.mjs scripts/verify-regression-evidence.mjs test/release/regressionEvidence.test.ts docs/regression/azure-devops-regression.md docs/regression/evidence/.gitkeep docs/acceptance-matrix.md
git commit -m "test: define Azure regression evidence gate"
```

This task prepares the mandatory external gate but does not install or mutate Azure DevOps.

---

### Task 11: Packaging, Version, CI, and Release Integrity

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.gitignore`
- Create: `scripts/lib/release-contract.mjs`
- Create: `scripts/lib/vsix-contract.mjs`
- Create: `scripts/sync-release-version.mjs`
- Create: `scripts/check-release-contract.mjs`
- Create: `scripts/package-vsix.mjs`
- Create: `scripts/verify-vsix.mjs`
- Create: `test/release/releaseContract.test.ts`
- Create: `test/release/vsixContract.test.ts`
- Create: `test/release/realVsix.integration.test.ts`
- Create: `.github/workflows/ci.yml`
- Create: `docs/releases/0.1.21-pre-gate.md`
- Modify: `spec/en/local-harness.en.md`
- Modify: `spec/tr/local-harness.tr.md`
- Modify as needed: other stale EN/TR testing/release notes identified by source comparison
- Update: `docs/acceptance-matrix.md`

**Interfaces:**

- `vss-extension.json.version` is the single human-edited release value (`0.1.21`).
- `sync-release-version` synchronizes package and root lock metadata only when explicitly invoked.
- Normal build/package commands are read-only and fail on version/identity/scope/input drift.
- `package:vsix` uses Task 2's path-safe cleaner through the production build, runs the release check, writes one installable pre-gate test artifact under ignored `artifacts/`, and verifies its contents.
- VSIX uses the exact observed file allowlist: `[Content_Types].xml`, `extension.vsixmanifest`, `extension.vsomanifest`, `static/control.html`, `static/control.css`, `dist/control.js`, and `dist/control.js.LICENSE.txt`; only the `static/` and `dist/` directory records may accompany them. Missing or additional entries fail, structurally excluding harness/test/source/fixtures/docs/node_modules/maps/secrets/junk.
- The package is not called a release candidate and release-candidate notes are not created until the external Azure gate passes.

- [ ] **Step 1: Write release-contract RED tests**

Use temporary controlled manifest/package/lock files and spawn the real Node CLI. Assert failures for version drift, any immutable identity/contribution/height/input change, public true, extra/missing scope, and effective version mismatch. This tests executable behavior rather than source text.

Expected RED: release contract module absent and current package/lock version `0.1.0` differs from manifest `0.1.21`.

```bash
npm test -- test/release/releaseContract.test.ts --reporter=verbose
```

Expected RED: the release-contract module is absent; once imported, the untouched package/lock version drift remains a deliberate failing case until Step 3 synchronizes it.

- [ ] **Step 2: Implement pure release validation and CLIs**

`sync-release-version.mjs` reads manifest once and writes package/lock mirrors only under explicit command. `check-release-contract.mjs` is read-only and exits non-zero with bounded messages.

- [ ] **Step 3: Run synchronization and prove stable mirrors**

```bash
node scripts/sync-release-version.mjs
node scripts/check-release-contract.mjs
git diff -- package.json package-lock.json
```

Expected: package and root lock version become `0.1.21`; dependency versions from Task 4 remain exact.

- [ ] **Step 4: Write VSIX verifier RED tests**

Create controlled temporary ZIP/VSIX files and spawn the real verifier CLI. Require the exact seven-file/two-directory allowlist above. Add one unexpected entry at a time—including `dist/test-harness.js`, `test.html`, `src/`, `test/`, `docs/`, `node_modules/`, fixture files, source maps, environment/credential names, macOS junk, and platform binaries—and require rejection. In `realVsix.integration.test.ts`, build a minimal temporary extension tree with the same manifest/file contract, invoke the pinned local `tfx extension create` executable against it, and pass the resulting real archive to the same verifier. Assert its normalized non-directory file list is the exact seven-file allowlist and its only directory records are `static/` and `dist/`.

```bash
npm test -- test/release/vsixContract.test.ts test/release/realVsix.integration.test.ts --reporter=verbose
```

Expected RED: the VSIX contract/verifier modules do not exist, so both the controlled-ZIP test and real-tfx integration test fail before implementation.

- [ ] **Step 5: Implement package scripts and VSIX verifier**

Set script contracts:

```json
{
  "audit:prod": "npm audit --omit=dev",
  "check:release": "node scripts/check-release-contract.mjs",
  "package:vsix": "npm run build && npm run check:release && node scripts/package-vsix.mjs && node scripts/verify-vsix.mjs",
  "verify": "npm run typecheck && npm test && npm run build && npm run check:build-outputs -- production && npm run build:harness && npm run check:build-outputs -- harness && npm run package:vsix"
}
```

Task 2's production build first clears `dist/` and `artifacts/` through the path-safe cleaner. `package-vsix.mjs` re-creates only the validated repository `artifacts/` directory, derives `artifacts/ygdb121.roosterjs-description-editor-0.1.21.vsix` from the manifest publisher/id/version, and invokes the pinned local tfx executable with that exact file path. The verifier opens that one artifact, reads the packaged extension manifest, enforces the observed exact allowlist above, reports SHA-256/size/entries, and exits non-zero on any violation.

- [ ] **Step 6: Add Linux CI**

Node 24 workflow runs fresh checkout:

```yaml
- run: npm ci
- run: npm run typecheck
- run: npm test -- --reporter=verbose
- run: npm run build
- run: npm run check:build-outputs -- production
- run: npm run build:harness
- run: npm run check:build-outputs -- harness
- run: npm run audit:prod
- run: npm run package:vsix
- run: git diff --exit-code
```

- [ ] **Step 7: Update source-authoritative docs and release notes**

Correct stale harness command/path and height `570` in both EN/TR where found. The pre-gate draft records behavior preservation, CSS/security changes, field independence, test counts, audit result, bundle delta from `537,439`, artifact name/SHA, upgrade, rollback, and real Azure evidence as pending. It says "pre-gate test artifact" throughout and contains no release-candidate claim.

- [ ] **Step 8: Run full release verification**

```bash
npm ci
npm run typecheck
npm test -- --reporter=verbose
npm run build
npm run check:build-outputs -- production
wc -c < dist/control.js
npm run build:harness
npm run check:build-outputs -- harness
npm run audit:prod
npm run package:vsix
git status --short
```

Expected: commands pass, audit has no unapproved production vulnerability, version/identity/scope match, production bundle excludes harness, the pre-gate test artifact is under ignored `artifacts/`, and tracked tree contains only intentional source changes before commit.

- [ ] **Step 9: Self-review and commit**

```bash
git add package.json package-lock.json .gitignore scripts/lib/release-contract.mjs scripts/lib/vsix-contract.mjs scripts/sync-release-version.mjs scripts/check-release-contract.mjs scripts/package-vsix.mjs scripts/verify-vsix.mjs test/release/releaseContract.test.ts test/release/vsixContract.test.ts test/release/realVsix.integration.test.ts .github/workflows/ci.yml docs/releases/0.1.21-pre-gate.md spec/en spec/tr docs/acceptance-matrix.md
git commit -m "build: enforce extension release integrity"
```

---

## Post-Task Whole-Branch Gates

After all eleven task reviews pass:

1. Generate the whole-branch review package from merge base `e6bd711ff4f1e60b4453b63de85418e17f0d472e` to HEAD.
2. Dispatch the most capable final reviewer against the complete design, plan, ledger rulings/deferred minors, and diff.
3. If findings exist, dispatch exactly one controlled fix agent, generate one scoped fix package, and dispatch one scoped re-review.
4. Run superpowers:verification-before-completion with fresh:

```bash
npm ci
npm run typecheck
npm test -- --reporter=verbose
npm run build
npm run check:build-outputs -- production
npm run build:harness
npm run check:build-outputs -- harness
npm run audit:prod
npm run package:vsix
git status --short
git log --oneline --decorate -n 20
```

5. Inspect the generated VSIX listing, artifact SHA/version/identity/scope, bundle delta, acceptance matrix, and regression evidence status.
6. Stop for explicit approval before installing the private VSIX or mutating an Azure DevOps organization.
7. After approval, execute both real Azure regression scenarios; run the verifier with `--require-azure-host`; commit only textual evidence/index files appropriate for source control; replace the pre-gate draft with `docs/releases/0.1.21-rc.md` only after both scenarios pass; rerun the full gates; and obtain final review of that evidence/release-note delta.
8. Only after the real Azure gate passes, use superpowers:finishing-a-development-branch and present integration options without selecting one.

## Required Final Evidence

- Result summary, preserved behavior, resolved defects, and exclusions.
- Changed-file table with responsibility/reason.
- Fresh command outputs and pass/fail/skip counts.
- Raw custom-field scenario Description before/after value hash, screenshots, DOM/style/table evidence, write log, and console result.
- Explicit-System.Description canonical/root-marker evidence.
- VSIX filename, SHA-256, version alignment, identity/scope, and content listing result.
- Every assumption, remaining risk, and SDD ledger `Ruling:` line.
- Clean `git status --short` and `git log --oneline --decorate -n 20`.
- Every verification-before-completion command/result.
