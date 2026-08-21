# Rooster description editor acceptance matrix

This matrix separates fresh automated/local-browser evidence from the still-pending external Azure DevOps gate. `passed automated/local` never implies Azure-host approval.

Task 10 evidence tooling and both executed synthetic local dry runs are complete. They did not access Azure DevOps and are not Azure-host evidence. Every Azure target below remains `pending external approval and execution`.

Task 11's local release contract, raw/effective VSIX verifier, pinned real-`tfx-cli@0.23.1` integration, production audit, and one ignored `0.1.21` pre-gate test artifact have passed locally. The Node 24 Linux workflow is defined but has not run on hosted CI. Packaging did not install, publish, or contact Azure DevOps. Exact measured details are in `docs/releases/0.1.21-pre-gate.md`.

| ID | Legacy baseline | Approved intentional hardening | Rewrite automated target | Harness target | Azure target | Status |
| --- | --- | --- | --- | --- | --- | --- |
| AC-01 | Editable lifecycle not yet characterized | None | Editable lifecycle component/integration | Editable screenshot | N/A | passed automated/local |
| AC-02 | Unsupported-WIT lifecycle not yet characterized | None | No field read/editor/sync/write | Unsupported state | N/A | passed automated/local |
| AC-03 | Read-only lifecycle not yet characterized | None | Preview only, no sync/write | Read-only state | N/A | passed automated/local |
| AC-04 | BKU fixture structurally preserves six tables, one style, headings, borders, inline style, and print CSS | Scoped/filtered CSS and canonical root | BKU sanitizer golden/DOM/style assertions | BKU screenshot | Explicit target visual check | passed automated/local; Azure pending external approval and execution |
| AC-05 | CSS security behavior not yet characterized | Scoped and filtered CSS | CSS security corpus | N/A | Audit record | passed automated; Azure pending external approval and execution |
| AC-06 | Sync/debounce behavior not yet characterized | Correct failure recovery and save flush | Fake timers and controlled writes | N/A | Mock host log | passed automated; Azure pending external approval and execution |
| AC-07 | Echo behavior not yet characterized | Correct echo suppression | In-flight/successful echo integration | N/A | Mock host/editor log | passed automated; Azure pending external approval and execution |
| AC-08 | Save flush behavior not yet characterized | Correct save flush | Queued/in-flight flush tests | N/A | Mock save log | passed automated; Azure pending external approval and execution |
| AC-09 | Toolbar order and all table-menu labels/states are characterized | Accessibility semantics without visual change | Table-menu component tests | Table interaction | N/A | passed automated/local: focused-menu visual plus live keyboard path |
| AC-10 | Write-failure status/recovery not yet characterized | Safe bounded errors and recovery | Fail-then-success controlled promise | Status/telemetry view | N/A | passed automated; local browser pending |
| AC-11 | Field parser fallback and manifest FieldName contract are characterized; field independence is not | Block implicit System.Description writes | Custom-field integration with forbidden Description write | Target-field selector and write log | Raw Description hash and field log | passed automated/local; evidence tooling/local dry run complete; Azure pending external approval and execution |
| AC-12 | Non-target change behavior not yet characterized | None | No-read/no-UI integration | N/A | Mock host log | passed automated |
| AC-13 | CSS reach isolation not yet characterized | Scoped/filtered CSS and canonical root | Scoped-selector and shell-reach tests | Before/after screenshot | N/A | passed automated/local |
| AC-14 | BKU fixture contains global reset selectors | Scoped/filtered CSS and canonical root | Global-reset selector tests | Computed-style inspection | N/A | passed automated/local |
| AC-15 | Repeated normalization/save/refresh/reopen not yet characterized | Canonical root and deterministic normalization | Repeat normalization integration | N/A | Canonical/hash comparison | passed automated; evidence tooling/local dry run complete; Azure pending external approval and execution |

## Approved intentional-hardening list

- Scoped and filtered CSS.
- A canonical `data-rdx-content-root` wrapper.
- Blocked implicit `System.Description` writes.
- Correct write-failure recovery and save flush.
- Safe bounded errors and runtime telemetry validation.
- Accessibility semantics without visual changes.
- A whitespace-only native link-prompt value becomes a no-op after trimming.
- Deterministic release and harness tooling.
