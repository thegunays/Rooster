# Local harness regression evidence

This is local synthetic evidence from the production controller/editor modules running against `FakeWorkItemHost`. It is not Azure DevOps host evidence and does not replace the external Task 10 gate.

## Recorded UTF-8 diagnostic corrective run

- Repository HEAD at build time: `fc7ca9cf8fb35777f1e99008a6948100a856af04` (the Task 9 UTF-8 diagnostic correction was uncommitted).
- Harness build command: `npm run build:harness && npm run check:build-outputs -- harness`.
- Harness build timestamp: `2026-08-20T11:47:09Z`.
- Browser: Codex In-app Browser.
- Browser/server request window: `2026-08-20T11:47:38Z` through `2026-08-20T11:49:35Z`.
- Server URL: `http://127.0.0.1:4173/test.html`.
- Server command: `python3 -m http.server 4173 --bind 127.0.0.1`.
- Network scope: loopback only. The in-app tab was closed, the server was stopped, and no listener remained after capture.
- Browser console warnings/errors: `[]`.
- Harness isolation: the fresh `dist/test-harness.js` contained no Azure SDK or Work Item form service identifiers. The harness uses the production configuration parser, `Sanitizer`, `SyncEngine`, `RoosterHost`, read-only view, and `RoosterDescriptionControl`, with the fake only at the Work Item boundary.

## Scenario evidence

| Acceptance | Executed result |
| --- | --- |
| AC-01 editable custom field | Loaded the exact BKU fixture into `Custom.RoosterContent` and `System.Description`. The initial target read diagnostic was `bytes=10423`. After the real table command, entered `s` through the labelled canonical contenteditable, waited past the 25 ms debounce, saved, refreshed, unloaded, and reloaded. Description retained exact raw equality and its exact SHA-256 with zero Description writes. The two successful target writes were the real table edit (`bytes=21230`) and typed edit (`bytes=21231`). Reopen retained one direct canonical root, six tables, 12 first-table rows, heading styling, and table/cell borders. |
| AC-02 unsupported WIT | Loaded `Bug`. The exact message was `Rooster editor is not enabled for work item type "Bug".` The visible log contained `EVENT load` and one successful `System.WorkItemType` read only. Target reads, editor, read-only view, sync status, and writes were absent. |
| AC-03 read-only | Loaded BKU with read-only selected. The page contained one read-only view, no editor, six tables, the styled dark-red heading, and 1 px black table/cell borders. The log contained the load plus `System.WorkItemType` (`bytes=3`) and `Custom.RoosterContent` (`bytes=10423`) reads, with no writes. |
| AC-04 BKU fidelity | Initial editable state had one style element, one direct canonical root, six tables, 11 first-table rows, 11 `.brick.heading` elements, the dark-red Times heading, and solid 1 px black table/cell borders. The same style and metadata remained after real Row Below and autosync while rows increased to 12. |
| AC-09 table keyboard | Right-clicked the first `#myTable1 td`. Focus began on `Row Above`; `ArrowDown` moved visible focus to `Row Below` (`insertBelow`, `role=menuitem`). A viewport capture persisted that open/focused state without blur. `Enter` closed the menu, grew the first table from 11 to 12 rows, retained six tables/canonical metadata/styles, and restored focus to the direct canonical `DIV[aria-label="Description editor"]`. Status became `Autosynced`; the target-only post-command write reported `bytes=21230`. |
| AC-13/AC-14 CSS reach | Empty-editor and post-BKU computed chrome objects for toolbar, status, message probe, and context menu were byte-for-byte JSON equal. The empty target read reported `bytes=0`; the BKU target read reported `bytes=10423`. The retained live style contained 67 rules and 161 selector branches; every branch began with `[data-rdx-content-root]`, and the unscoped list was `[]`. |

## Exact field and editor assertions

- Tracked BKU/Description SHA-256 before and after the custom-field sequence: `0005e3eff97cc3aa39bbb2d90aa5b6f76b4435eb4b679d5ae3e1182b61c24b2a`.
- Description raw JavaScript string equality: true; before/after values were both 10,376 UTF-16 code units and 10,423 UTF-8 bytes.
- Description write log: zero entries.
- Initial visible read log: `READ System.WorkItemType succeeded bytes=3` and `READ Custom.RoosterContent succeeded bytes=10423`.
- Custom target write log: two successful writes, `bytes=21230` and `bytes=21231`.
- Initial physical editor: `contenteditable=false`, no `aria-label`.
- Initial direct canonical root: exactly one, `contenteditable=true`, `aria-label="Description editor"`.
- After Row Below: exactly one direct canonical root, six tables, 12 first-table rows, one style element, style text length 8,898.
- After save/refresh/unload/reload: exactly one direct canonical root, six tables, 12 first-table rows, and unchanged computed BKU visual contract.

## BKU metadata and computed styles

- `#myTable1.pdf_table` remained present before and after the real keyboard command.
- `.brick.heading` metadata remained present; the fixture contained 11 such headings.
- `Tanım` heading: `rgb(139, 0, 0)`, 16 px, weight 700, Times New Roman.
- First table: 1 px solid black border and collapsed border model.
- First table cell: 1 px solid black border.
- Template style: one direct style element with text length 8,898 before and after the command.

The following chrome values remained equal before and after BKU global resets:

| Surface | Recorded computed values |
| --- | --- |
| Toolbar | `display:flex`; 6 px gap; 2 px padding; bottom border `1px solid rgb(208, 215, 222)`; linear-gradient background; Segoe UI stack. |
| Status | background `rgb(246, 248, 250)`; color `rgb(87, 96, 106)`; 10 px font; top border `1px solid rgb(208, 215, 222)`; padding `1px 4px`. |
| Message probe | white background; color `rgb(87, 96, 106)`; border color `rgb(208, 215, 222)`; dashed 1 px harness probe border; padding `7px 9px`; 11 px font. |
| Context menu | fixed position; 320 px width; 8 px padding; white background; `1px solid rgb(208, 215, 222)` border; `rgba(31, 35, 40, 0.18) 0px 10px 28px 0px` shadow. |

## Persistent focused-menu capture

The open-menu evidence used `tab.screenshot({ fullPage: false })` while `Row Below` held DOM focus. Unlike the full-page capture path, this viewport capture did not emit a window blur: immediately after capture, the menu was still visible and `Row Below` remained the active command. Only then was `Enter` sent, and menu close, row insertion, autosync, and canonical-root focus restoration were asserted live.

The browser screenshot bytes were JPEG. Each genuine captured pixel buffer was losslessly decoded and re-encoded with macOS `sips -s format png`, then checked with `file`, its first eight bytes, dimensions, and SHA-256. No DOM was cloned, frozen, restyled, or fabricated for capture; production blur handling was not changed.

## Screenshot artifacts

| File | Pixel size | PNG signature | SHA-256 |
| --- | --- | --- | --- |
| `docs/regression/local-harness/editable-bku.png` | 1265 x 1211 | `89 50 4e 47 0d 0a 1a 0a` | `01a675a6535dc70ccab7524ce23852af157d04e191b938536008a904c8539d7d` |
| `docs/regression/local-harness/read-only.png` | 1265 x 2863 | `89 50 4e 47 0d 0a 1a 0a` | `6247a1255aa6bafbe721a5c78a285d3435adc52f644c3b3487e9f094b1af04f3` |
| `docs/regression/local-harness/unsupported-wit.png` | 1265 x 1110 | `89 50 4e 47 0d 0a 1a 0a` | `5cb71924894de91e463dc60d2583310b12be54fa96896b7473451d81bf4d4827` |
| `docs/regression/local-harness/table-menu-keyboard.png` | 1265 x 712 | `89 50 4e 47 0d 0a 1a 0a` | `56d3819b574026c8fd1d8b0526f5e429aa4bf100c3c4cf62c8af6f4fbf993c58` |
| `docs/regression/local-harness/chrome-isolation.png` | 1265 x 1211 | `89 50 4e 47 0d 0a 1a 0a` | `66d1ca0367b69f467e9b465bd415737640b917d257b4c3b3523267d1c47933cd` |

`table-menu-keyboard.png` was visually inspected and shows the production menu open with the `Row Below` command carrying its visible blue focus ring. The other four scenario artifacts were also visually inspected after PNG re-encoding.

## Re-run

```bash
npm run build:harness
npm run check:build-outputs -- harness
python3 -m http.server 4173 --bind 127.0.0.1
```

Open `http://127.0.0.1:4173/test.html` in the Codex In-app Browser, use the visible configuration and lifecycle controls, and stop the loopback server afterward. Keep every Azure row pending until the separately authorized external evidence gate is executed.
