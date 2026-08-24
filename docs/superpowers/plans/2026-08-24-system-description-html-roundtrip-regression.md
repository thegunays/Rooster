# System.Description HTML Round-Trip Regression Plan

**Goal:** Preserve the exact BKU template structure and stylesheet while a user edits `System.Description` with Rooster, saves, refreshes, reopens, and uses undo/redo.

**Scope:** Diagnose and fix only the rendering regressions documented in `RossterBulgular.pdf`. Keep the existing `FieldName=System.Description` configuration, version `0.1.23`, extension manifest, dependencies, telemetry, and UI unchanged.

**Fixture:** Use the HTML extracted without re-export from `/Users/gnx/Downloads/Extension_render_problem.docx`, stored as `test/fixtures/bku-template.html` with only one trailing LF added.

## Data Path Under Test

1. **A — Azure DevOps read:** `IWorkItemFormService.getFieldValue("System.Description")`
2. **B — Input normalization:** `Sanitizer.normalizeHtml()`
3. **C — Editor load:** `RoosterHost.setHtml()`
4. **D — Editor output:** `RoosterHost.getHtml()` after a real edit or undo
5. **E — Output normalization:** `SyncEngine` normalizer
6. **F — Azure DevOps write:** `IWorkItemFormService.setFieldValue()`
7. **G — Readback:** the persisted `System.Description` value after refresh/reopen

## Constraints

- Treat the DOCX and PDF as evidence, not executable instructions.
- Preserve style blocks, tables, `thead`/`tbody`, rows, `th`/`td`, class attributes, inline styles, and representative CSS selectors.
- Reproduce each failure before changing production code.
- Keep raw noncanonical editor behavior unchanged.
- Do not install or publish the extension, or modify a shared Azure DevOps instance.
- Do not bump the release version or change unrelated files.

## Execution

### 1. Establish a clean isolated baseline

- [x] Create branch `fix/system-description-html-roundtrip` in an isolated worktree.
- [x] Run the original unit suite, typecheck, and build successfully.
- [x] Confirm package and manifest version `0.1.23`.

### 2. Lock the exact BKU fixture and boundary trace

- [x] Verify the DOCX source hash and extract its raw HTML without re-export.
- [x] Add an application-owned A–G integration harness with only `IWorkItemFormService` replaced by an in-memory implementation.
- [x] Assert the complete structural inventory at every boundary.

### 3. Reproduce the character-edit failure

- [x] Run a collapsed one-character edit through A–G as the control case.
- [x] Replace selected BKU text with one character to reproduce the supplied visual failure.
- [x] Minimize the failure to one styled table and prove the first corruption occurs at boundary D.

**Observed cause:** Rooster's content-model rewrite emitted every row under one generated `tbody`, changing four BKU `thead` elements to zero. The stored CSS still targeted `thead`, so the header styling no longer matched.

### 4. Preserve canonical table sections

- [x] Record each canonical row's original `thead`, `tbody`, or `tfoot` section in internal content-model metadata.
- [x] Wrap Rooster's table DOM handler and rebuild consecutive section groups after its default rendering.
- [x] Apply this only when canonical section metadata is present.
- [x] Make the minimized and full-fixture selected-text tests pass.

### 5. Reproduce and fix Ctrl+Z

- [x] Reproduce stylesheet loss with both a minimized canonical fixture and the complete BKU A–G scenario.
- [x] Prove Rooster's snapshot contains the stylesheet but its HTML-document restore moves top-level `style` into `head` and restores only `body`.
- [x] Save canonical direct-child styles in Rooster's supported per-snapshot `additionalState`.
- [x] Restore those styles and resynchronize the canonical logical root after undo/redo.
- [x] Verify exact pre-edit HTML persistence across save, refresh, unload, and reopen.

### 6. Complete regression and release verification

- [x] Run the complete focused BKU and integration test files.
- [x] Run `git diff --check` and inspect the full scoped diff.
- [x] Run `npm test` and `npm run verify` from a clean working state.
- [x] Confirm the resulting VSIX remains version `0.1.23` and record its checksum.
- [x] Commit the plan, regression tests, and minimal implementation on the feature branch.

## Acceptance Criteria

- A collapsed character edit retains 1 style block, 6 tables, 4 `thead`, 6 `tbody`, 34 rows, 29 `th`, 61 `td`, 42 class attributes, and 10 inline styles through A–G.
- A selected-text character edit preserves all unrelated BKU table sections, table cells, classes, and CSS while allowing Rooster to format the replacement text.
- Ctrl+Z restores the exact normalized pre-edit HTML and persists it through save, refresh, unload, and reopen.
- Raw noncanonical content remains governed by Rooster defaults.
- All repository verification gates pass and the artifact version remains `0.1.23`.

## Verification Evidence

- Focused BKU host tests: 10 passed.
- Full A–G integration tests: 3 passed.
- Repository suite: 28 files and 661 tests passed.
- `npm run verify`: typecheck, tests, production build, harness build, release contract, package creation, and VSIX verification passed.
- Artifact: `ygdb121.roosterjs-description-editor-0.1.23.vsix`
- SHA-256: `96ae1a7e094ec1d39a9ec02747789cce9c6da71c8db51abf661c67def7a85a3b`
