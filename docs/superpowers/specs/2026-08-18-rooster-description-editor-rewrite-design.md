# Rooster Description Editor behavior-equivalent rewrite design

Date: 2026-08-18

Status: Approval requested; implementation is not authorized

Branch: rewrite/rooster-description-editor

Isolated worktree: /Users/gnx/Repo/Rooster0.1.1-rewrite-rooster-description-editor

Starting commit: e6bd711ff4f1e60b4453b63de85418e17f0d472e

## 1. Executive decision

Use a parallel, behavior-equivalent rewrite on the isolated branch. The current main branch remains the product baseline and is not edited. Within the rewrite branch, characterization tests are written first and each canonical module is replaced only after its observable contract is captured. The shipped bundle contains one implementation, not a permanent legacy/rewrite switch.

This design preserves the current extension identity, Azure DevOps contribution, visible behavior, field contract, and browser-only architecture. It fixes the BKU regression by making field selection an enforced capability and by replacing regex-only CSS handling with deterministic parsing, declaration filtering, selector scoping, and idempotent HTML normalization.

The design introduces two dependency decisions that require approval:

- Add css-tree 3.2.1 as an exact runtime dependency and @types/css-tree 3.2.0 as an exact development dependency.
- Upgrade and pin the existing DOMPurify dependency from the installed 3.3.3 to 3.4.13.

It also makes one defensive configuration decision that requires approval: the parser continues to return System.Description as the default FieldName, but an absent or empty raw FieldName is not granted write capability. Because the manifest already marks FieldName as required, a correctly configured production contribution is unaffected. A malformed or incomplete host configuration is rejected during bootstrap, before contribution registration/load success, instead of implicitly writing System.Description.

No implementation plan or application code is part of this design-stage change.

## 2. Evidence and baseline

### 2.1 Repository and archives

- The primary repository is /Users/gnx/Repo/Rooster0.1.1/roosterjs-ado-ext-0-1-1.
- The isolated worktree starts clean at e6bd711ff4f1e60b4453b63de85418e17f0d472e.
- Rooster0.1.1.zip, Rooster0.1.1 2.zip, and Rooster0.1.1 3.zip contain the same 40 meaningful source, configuration, test, and documentation files as the checkout.
- The aggregate SHA-256 of those 40 meaningful files is 58bfe95d3045410b33b4717b81044623f2bedf82f02a10083affce0c572abae3.
- Rooster0.1.1.zip and Rooster0.1.1 3.zip are byte-identical. Rooster0.1.1 2.zip differs only in archive/container metadata.
- Archive copies of node_modules, dist, .git, .DS_Store, __MACOSX, and VSIX files are generated evidence, not source-of-truth inputs.

### 2.2 Product documents and regression evidence

- The two PROJECT_SRS_HLD_UIUX PDF copies are byte-identical, 42-page Turkish SRS/HLD/UIUX documents dated 2026-08-18.
- The PDF confirms a private, client-side Azure DevOps iframe control with no backend, database, custom API, browser storage, or external telemetry service.
- Extension_render_problem.docx is a five-page regression report. It shows a valid BKU template in System.Description before editing the extension field and broken headings/table borders after entering one character into the extension field.
- The DOCX screenshots prove a visual rerender regression; they do not by themselves prove that raw System.Description bytes changed. The release regression therefore captures raw field equality and independent visual/DOM/style evidence.
- The literal BKU HTML/CSS is recoverable from the DOCX document XML. It contains six tables, heading and color classes, global reset selectors, inline styles, and a safe @media print rule.
- The fixture uses these CSS properties: background, background-color, border, border-bottom, border-collapse, border-radius, border-spacing, box-sizing, color, display, flex-basis, float, font, font-family, font-size, font-weight, height, line-height, list-style, margin, margin-bottom, margin-right, min-height, min-width, overflow-y, padding, padding-left, position, text-align, text-decoration, transition, vertical-align, and width.
- The source fixture contains no external CSS resource. Its HTML contains a normal HTTPS anchor, which is distinct from a CSS url() resource.

### 2.3 Clean dependency, test, and build baseline

The repository-provided node_modules directory was not trusted. A clean npm ci was run in the isolated worktree.

The following are dated command observations made in the isolated worktree during this design session; they are not facts inferred only from tracked repository files. The registry version observations are additionally linked to their primary package sources in Section 7.1.

| Check | Baseline result |
| --- | --- |
| Node.js | v24.13.0, arm64 |
| npm | 11.6.2 |
| npm ci | Passed; 507 packages installed |
| Lockfile after npm ci | No tracked change |
| npm test -- --reporter=verbose | Passed; 4 files, 15 tests, 0 failed |
| npm run build | Passed |
| TypeScript: tsc --noEmit | Passed |
| Production bundle | dist/control.js, 537,439 bytes |
| Webpack | Three performance warnings |
| npm audit --omit=dev | One moderate production finding against installed dompurify 3.3.3 |
| Full npm audit | 10 findings: 3 moderate and 7 high, mostly development/tooling transitives |

The old PDF note about a Linux native binding failure is not a current application failure. The clean worktree baseline passes. Linux remains a required CI environment because repository-provided platform-specific dependencies were previously misleading.

### 2.4 Version baseline

| Source | Version |
| --- | --- |
| package.json | 0.1.0 |
| vss-extension.json | 0.1.21 |
| archived VSIX artifacts | 0.1.9 through 0.1.16, then 0.1.19 and 0.1.20 |

The first rewrite release candidate retains extension version 0.1.21 and aligns package.json, the packaging manifest, and the produced VSIX to that value.

### 2.5 Source-authoritative conflicts

Current source wins where the prose specification differs:

- The exact source status is Pending autosync... with three periods, not a typographic ellipsis.
- The exact bootstrap prefix is Failed to initialize Rooster Description control: with lower-case control.
- Concrete feature event names are feature_used_table, feature_used_markdown, and feature_used_codeblock. The prose notation feature_usage: table/markdown/codeblock is treated as a conceptual label for these existing events.
- Manifest height is 570; older notes that say 700 are stale.
- The local harness currently expects dist/test-harness.js, while Webpack currently emits only dist/control.js. This is a verified build-chain gap.

Characterization tests freeze the source-authoritative strings and event names before replacement.

## 3. Goals, non-goals, and immutable boundaries

### 3.1 Goals

- Preserve existing product behavior and UI while improving module isolation and testability.
- Keep the extension field independent from System.Description.
- Read and write only the explicitly configured HTML FieldName.
- Preserve the BKU template's safe tables, borders, typography, spacing, colors, and safe print styles.
- Prevent template HTML/CSS from executing code or styling the toolbar, status region, menu, iframe page, or host page.
- Preserve debounce, latest-value coalescing, serialized writes, echo suppression, save flush, refresh/reset reload, and disposal.
- Make every lifecycle branch and table/editor interaction testable through narrow injected ports.
- Make clean build, harness build, test, package, version, and VSIX-content checks deterministic.

### 3.2 Non-goals

- No visual redesign.
- No new toolbar controls, icon system, modal, retry UX, onboarding, localization system, or configurable contribution height.
- No backend, database, custom REST/GraphQL API, OAuth/token collection, RBAC engine, external telemetry, browser persistence, image upload, or collaboration service.
- No automatic write retry or backoff.
- No silent RoosterJS upgrade.
- No code splitting solely to remove a bundle warning.

### 3.3 Immutable extension contract

The implementation and release verifier treat these values as constants:

| Property | Required value |
| --- | --- |
| Extension ID | roosterjs-description-editor |
| Publisher | ygdb121 |
| Contribution ID | rooster-description-control |
| Contribution type | ms.vss-work-web.work-item-form-control |
| Target | Microsoft.VisualStudio.Services |
| Public | false |
| Scope | vso.work_write |
| Entry URI | static/control.html |
| Contribution name | Description (Rooster) |
| Height | 570 |

The inputs FieldName, EnabledWits, DebounceMs, EnableMarkdownAutoformat, and EnableCodeBlock remain present. FieldName remains a required Azure DevOps WorkItemField whose type is HTML.

The instruction to access Azure DevOps only through IWorkItemFormService is interpreted as a Work Item data boundary. Field values and Work Item type are accessed only through IWorkItemFormService. The Azure DevOps Extension SDK is still required for iframe initialization, readiness, contribution configuration/registration, load notification, and non-content host/extension metadata; those operations are separately mandated by the host-contract requirements and do not provide Work Item field data.

## 4. Approach comparison

| Approach | Main-branch safety | Behavior-regression risk | Characterization and review | Temporary complexity | Decision |
| --- | --- | --- | --- | --- | --- |
| In-place refactor | Main can be protected by a worktree, but each edit immediately replaces the only branch implementation | High: architectural moves and bug fixes are interleaved | Harder to compare intermediate behavior | Low duplication | Rejected |
| Parallel behavior-equivalent rewrite | Main remains unchanged; rewrite evolves on its own branch | Lowest practical risk: current outputs are frozen first and modules cross gates independently | Strong: old behavior is the oracle until each replacement is accepted | Moderate test and branch overhead | Recommended |
| Independent greenfield rewrite | Main remains unchanged | Highest: easy to omit host/lifecycle/table details and invent behavior | Weak until late end-to-end comparison | Highest duplicate architecture and cutover cost | Rejected |

Parallel means a parallel development line, not two implementations shipped at runtime. The branch keeps production entry behavior stable while tests and module replacements proceed in the required order. Temporary comparison helpers may live under test support, but no legacy feature flag or second production entry survives cutover.

## 5. Target architecture and module boundaries

The data flow is:

Azure DevOps SDK lifecycle event
  -> RoosterDescriptionControl
  -> WorkItemBridge
  -> configured FieldName only
  -> Sanitizer inbound normalization
  -> RoosterHost or read-only preview
  -> editor change
  -> SyncEngine outbound normalization
  -> WorkItemBridge
  -> the same configured FieldName only

### 5.1 Bootstrap and lifecycle

Files:

- src/control/index.ts
- src/control/RoosterDescriptionControl.ts

index.ts is only the SDK composition root. It initializes the SDK, waits for readiness, locates the root, obtains configuration, creates dependencies, registers the current contribution ID, and reports load success or failure.

RoosterDescriptionControl coordinates Azure lifecycle callbacks. It does not directly obtain SDK services, parse CSS, implement debounce, mutate table cells, or construct telemetry envelopes.

Constructor dependencies are narrow factories or interfaces for:

- WorkItemBridge
- Sanitizer
- RoosterHost/read-only view
- SyncEngine
- TelemetryClient
- clock for the Synced time

Production defaults preserve current imports and behavior. Tests inject deterministic fakes.

### 5.2 Host adapter

File:

- src/bridge/WorkItemBridge.ts

This is the only module that knows IWorkItemFormService and WorkItemTrackingServiceIds. Its public contract is:

- create after SDK.ready
- getFieldValue(fieldName) -> string
- setFieldValue(fieldName, string) -> Promise<void>
- getWorkItemType() -> string using System.WorkItemType
- hasFieldChanged(args, targetField) -> boolean

Null and undefined values become empty strings. Other primitive host values retain the source behavior of String conversion. Field-change matching is an own-property check and is scoped to the configured target.

### 5.3 Content security

File:

- src/bridge/Sanitizer.ts

Sanitizer owns all inbound and outbound normalization:

- tolerant HTML parsing and style extraction
- DOMPurify HTML sanitization
- CSS parsing, validation, and canonical generation
- selector scoping
- inline declaration filtering
- one stable content wrapper
- idempotent serialization

No caller may set host-derived or editor-derived HTML without passing this boundary.

### 5.4 Synchronization

File:

- src/bridge/SyncEngine.ts

SyncEngine owns:

- normalization at schedule time
- debounce timer
- one latest queued value
- serialized writes
- last successful value
- in-flight echo candidate
- flush
- host-state alignment
- disposal
- failure recovery

It knows no Azure SDK, DOM elements, telemetry format, or status strings.

### 5.5 Editor host

Files:

- src/control/RoosterHost.ts
- src/control/toggleCodeBlock.ts

RoosterHost owns RoosterJS creation/disposal, the current text toolbar, editor events, Markdown plugin, native link prompt, 3 by 3 table insertion, snapshot undo/redo, status node, and one change-output path.

toggleCodeBlock remains a focused adapter. RoosterJS stays pinned at 9.45.2. Its two existing private deep imports are isolated here, covered by contract tests, and treated as an explicit dependency-upgrade gate because the equivalent helpers are not publicly exported by the installed Rooster package.

### 5.6 Table operations

Files:

- src/control/TableContextMenu.ts
- src/control/tableSelection.ts

tableSelection computes a logical grid and selection state for rowspan/colspan tables. TableContextMenu maps menu actions to RoosterJS editTable operations wherever supported, computes active/enabled state, clamps layout, owns focus, and removes its global listeners on dispose.

Full Width remains visible only in its existing unsupported/disabled state. No direct uncontrolled table rewrite is introduced.

### 5.7 Configuration

File:

- src/config/defaults.ts

The immutable ControlConfig retains:

- fieldName
- fieldNameWasExplicit
- enabledWits
- debounceMs
- enableMarkdownAutoformat
- enableCodeBlock

The five existing defaults remain System.Description, SRS/HLD, 500, true, and true. WIT names are trimmed and compared case-insensitively. Invalid or negative debounce uses 500. Existing true forms are true, 1, yes, and on; existing false forms are false, 0, no, and off.

fieldNameWasExplicit is true only when the raw FieldName input is a non-empty trimmed string. This separates the required parser default from permission to write.

### 5.8 Telemetry

File:

- src/telemetry/TelemetryClient.ts

Telemetry remains console.info only. It emits the source-authoritative event names, an ISO timestamp, extension version, host type, and primitive properties. Runtime validation drops non-primitive values even if TypeScript is bypassed.

No HTML, CSS, field content, selection content, URL, raw Error object, or stack is emitted. Error telemetry contains a bounded code and a controlled operation identifier.

Sanitizer and table diagnostics use controlled console.warn records and do not invent additional telemetry event names.

The exact telemetry event contract is:

- control_loaded
- autosync_success
- autosync_failure
- readonly_rendered
- feature_used_table
- feature_used_markdown
- feature_used_codeblock

The exact visible string contract is:

- Ready
- Editing {FieldName} on {WorkItemType}
- Pending autosync...
- Autosynced
- Synced ({time})
- Reloaded from work item form
- Autosync failed: {bounded error}
- Work item unloaded.
- Rooster editor is not enabled for work item type "{type}".
- Failed to initialize Rooster Description control: {bounded error}

The placeholders above denote runtime substitution; literal punctuation and capitalization remain source-authoritative.

### 5.9 Static entry and shell styling

Files:

- static/control.html
- static/control.css

The entry path and toolbar/editor/status structure stay unchanged. Shell class names remain rdx-prefixed. Accessibility additions are semantic only and do not change visual layout.

## 6. Azure DevOps host contract

### 6.1 Bootstrap order

The required sequence is:

1. SDK.init with loaded:false and applyTheme:true.
2. Await SDK.ready.
3. Resolve #app; absence is a bootstrap failure.
4. Read SDK configuration and extension/host metadata.
5. Parse configuration and validate that raw FieldName was explicitly supplied. Missing/empty FieldName is a bootstrap failure, despite the retained parser default.
6. Create WorkItemBridge through SDK.getService.
7. Create the lifecycle controller.
8. Register SDK.getContributionId() with a factory returning that controller.
9. Call SDK.notifyLoadSucceeded.

Any failure before success notification:

- writes a bounded safe message with textContent, never innerHTML;
- uses the source-authoritative prefix Failed to initialize Rooster Description control:;
- calls SDK.notifyLoadFailed with a bounded message;
- does not register a partial control or call notifyLoadSucceeded.

No host service is requested before SDK.ready.

### 6.2 Field capability invariant

All reads, field-change filters, and writes use the fieldName captured in the immutable configuration for that control instance.

The bridge has no convenience method that writes System.Description. The only application write call is setFieldValue(config.fieldName, normalizedValue).

Two independent scenarios are mandatory:

1. Explicit FieldName=Custom.RoosterContent:
   - only Custom.RoosterContent is read for editor content and written;
   - System.Description is never passed to setFieldValue;
   - a System.Description change event is ignored;
   - the BKU Description bytes/hash remain unchanged through edit, debounce, save, refresh, and reopen.
2. Explicit FieldName=System.Description:
   - writing Description is allowed;
   - inbound and outbound content uses the same canonical sanitizer;
   - repeat save/refresh/reopen is compared canonically because the approved sanitizer intentionally scopes CSS and adds the stable content root.

If raw FieldName is absent or empty, parsing still yields the documented default System.Description, but fieldNameWasExplicit is false. Bootstrap rejects the configuration before bridge creation, contribution registration, or notifyLoadSucceeded and uses the existing safe initialization-error surface plus notifyLoadFailed. This resolves the conflict between preserving the parser default and the primary safety rule that System.Description must never be written implicitly.

### 6.3 Lifecycle contract

onLoaded:

1. Increment a lifecycle generation and dispose the previous generation.
2. Read Work Item type and isReadOnly.
3. Track control_loaded without content.
4. If WIT is unsupported, render only the existing informational message. Do not read the target field, create the editor, create SyncEngine, or expose a write callback.
5. Read and normalize the target field.
6. For read-only, render only the sanitized preview and track readonly_rendered. Do not create RoosterHost or SyncEngine.
7. For editable, create RoosterHost, load normalized HTML, create SyncEngine, align it to host state, and attach one change listener.

onFieldChanged:

- Ignore non-target changedFields without a host read.
- Read and normalize the target value.
- In read-only mode, update only the preview.
- In editable mode, ignore last-successful or in-flight echo values.
- For a real external change, update the editor and align SyncEngine to that host value.

onSaved:

- Await SyncEngine.flush.
- Set Synced ({time}) only after a successful flush.
- On failure, retain Autosync failed: {error}; never overwrite it with success.

onRefreshed and onReset:

- Re-read and normalize the configured target.
- Replace the editable/read-only content.
- Align SyncEngine to the host value.
- Show Reloaded from work item form for editable mode.

onUnloaded:

- Increment the lifecycle generation.
- Remove the host change subscription.
- Dispose SyncEngine, RoosterHost, TableContextMenu, and their listeners.
- Clear in-memory field/WIT/read-only state.
- Render Work item unloaded.

Async work captures its generation. A completion from an old load/unload generation may not replace the current UI, emit a current status, enqueue a new write, or invoke callbacks. Disposal prevents queued-but-not-started writes. A field write that already entered the non-cancellable IWorkItemFormService call may still complete after unload; the implementation records this host limitation and suppresses only its stale UI/telemetry callbacks.

## 7. HTML and CSS security model

### 7.1 Parser choice

Two options were evaluated:

| Option | Strengths | Weaknesses | Decision |
| --- | --- | --- | --- |
| Standards-oriented CSS AST parser | Deterministic parsing/generation, explicit node walk, selector rewriting, property grammar validation, stable tests in browser and jsdom | Adds a runtime dependency and bundle weight | Select css-tree 3.2.1 |
| Browser CSSOM | No new parser dependency; browser rejects some invalid syntax | Serialization varies by engine, jsdom parity is weak, rejected rules can disappear without auditable reason, source-to-source selector rewriting is brittle | Reject |

css-tree is isolated behind Sanitizer so it can be replaced without changing lifecycle/editor code. The exact package is pinned and bundle growth is measured against 537,439 bytes. Its parser and generator behavior is covered by our own security tests rather than trusted as a complete policy.

References:

- https://www.npmjs.com/package/css-tree
- https://github.com/csstree/csstree/blob/master/docs/parsing.md

DOMPurify remains the HTML sanitizer and is pinned to 3.4.13, the current registry release observed on 2026-08-18. The installed 3.3.3 is inside the range reported by the clean production audit. Upgrade compatibility and a fresh audit are release gates.

References:

- https://www.npmjs.com/package/dompurify
- https://github.com/cure53/DOMPurify/releases

### 7.2 Canonical normalization pipeline

normalizeHtml is the sole canonical entry and executes these stages:

1. Treat null/undefined as an empty string.
2. Parse the input into a detached HTML document using the browser parser.
3. Extract all style element text in document order; remove every style element from the parsed HTML.
4. Enforce a 100,000-character aggregate CSS limit before parsing. If the aggregate exceeds the limit, discard all template CSS but continue with HTML sanitization. Splitting across style blocks cannot bypass the limit.
5. Sanitize the remaining markup with DOMPurify's HTML profile.
6. Explicitly forbid style at this stage plus head, title, script, iframe, object, embed, link, meta, form, input, button, and textarea. DOMPurify removes executable event attributes and unsafe URI forms. SVG and MathML are outside the selected HTML profile.
7. Walk every remaining inline style attribute. Parse it as a declaration list, keep only permitted declarations/values, generate canonical CSS, or remove the empty attribute.
8. Parse extracted CSS as an AST. Reject parser Raw nodes and disallowed at-rules, scope every accepted selector, filter declarations, and generate canonical CSS.
9. Combine accepted rules in original cascade order into at most one style element.
10. Reserve data-rdx-content-root for the sanitizer. Remove that marker from all input elements, unwrap any previously canonical marker element into its child content, and create a fresh neutral div whose only attribute is data-rdx-content-root with an empty value. Any class, id, inline style, event, or other attribute presented on an input marker is discarded rather than inherited by the canonical root.
11. Move all sanitized content into that one fresh wrapper in source order. A second normalization unwraps and recreates the same neutral wrapper, so wrappers never nest and attacker-controlled root attributes never survive.
12. Sort normal HTML attributes lexicographically by normalized name during serialization, while preserving attribute values and child/text-node order. Inline declarations and stylesheet rules retain their policy-defined order.
13. Serialize as the optional canonical style element followed by the content wrapper and trim outer whitespace.

No parser exception or rejected CSS path returns raw input. If CSS processing fails unexpectedly, all template CSS and inline style values are discarded and the DOMPurify-sanitized HTML remains inside the safe wrapper. If HTML sanitization itself cannot safely complete, return an empty canonical content wrapper.

This construction must satisfy normalizeHtml(normalizeHtml(value)) === normalizeHtml(value).

### 7.3 Why the wrapper is persisted

The stable marker is part of canonical field HTML, not only an ephemeral shell attribute:

- scoped rules still match when the field is rendered after save/reopen;
- an explicitly targeted System.Description remains renderable outside this extension if Azure DevOps preserves the allowed data attribute;
- style rules remain isolated from the extension chrome and surrounding host;
- repeated normalization can identify the canonical root.

The root is always recreated with exactly one empty data-rdx-content-root attribute. It cannot inherit template classes, dimensions, positioning, inline style, or !important declarations from input attributes. It may receive only policy-filtered stylesheet declarations that came from explicit html/body/:root selector mappings; all other template styling begins at descendants.

RoosterHost edits the wrapper's content and emits the complete canonical fragment. The read-only preview uses the same wrapper. The real Azure DevOps regression gate verifies that the host preserves data-rdx-content-root. If the host strips it, release is blocked and the security design must be amended with user approval; the implementation must not silently fall back to global CSS.

### 7.4 Selector policy

Every selector in every accepted style rule is parsed, not text-prefixed.

- Comma-separated selector lists are transformed branch by branch. A rejected branch is dropped while accepted branches in the same list remain in source order; a rule with no accepted branch is dropped.
- A selector with no document-root token and no existing canonical root is prefixed with [data-rdx-content-root] plus a descendant combinator. For example, table becomes [data-rdx-content-root] table.
- A maximal leading chain made only from html, body, and :root document-root compounds is collapsed to one [data-rdx-content-root] compound. The combinator between the final root compound and content is preserved: body > table becomes [data-rdx-content-root] > table; html body .x becomes [data-rdx-content-root] .x; :root > * becomes [data-rdx-content-root] > *; html > body > .x becomes [data-rdx-content-root] > .x.
- A document-root compound carrying an additional topology-dependent pseudo-class, such as body:first-child, is rejected rather than guessed. A document-root token occurring after a content selector, such as .x body, is also rejected.
- A selector already beginning with exactly [data-rdx-content-root] is kept at one root and is not prefixed again. A marker occurring later in a selector or carrying a value other than the canonical empty marker is rejected.
- Universal, type, class, ID, static attribute, and combinator nodes are allowed.
- The fixture-required :hover, :first-child, :last-child, and :nth-child() pseudo-classes are allowed.
- Shadow-DOM/global escape selectors and constructs such as :host, :host-context, ::part, ::slotted, and nonstandard :global are rejected.
- A selector parse failure rejects that branch.
- The canonical root is never attached to toolbar, status, message, or context-menu nodes.

Golden selector tests cover every example above, mixed accepted/rejected lists, the BKU reset selector, body .main_pdf_cont, html .main_pdf_cont, table descendants, and repeat scoping.

Within @media, only an exact print media query is accepted. Its nested selectors undergo the same transformation. @import, @font-face, @keyframes, @supports, @namespace, @page, @layer, and unknown at-rules are rejected. The BKU fixture's @media print rule is preserved.

### 7.5 Declaration policy

A declaration is accepted only when:

1. its property is on the allow-list;
2. css-tree validates the value grammar for that property;
3. its AST contains no URL node, custom property, var(), expression(), JavaScript/VBScript token, behavior, -moz-binding, or unknown/raw node;
4. its additional property-specific restrictions pass.

The allow-list covers the fixture and current Rooster output:

- typography: font, font-family, font-size, font-style, font-weight, line-height;
- text: color, text-align, vertical-align, text-decoration, white-space;
- box sizing: width, min-width, max-width, height, min-height, max-height, box-sizing;
- spacing: margin and directional margins, padding and directional padding;
- borders/tables: border and directional border shorthands/parts, border-collapse, border-spacing, border-radius;
- safe backgrounds: background-color and color-only background;
- layout needed by the fixture/editor: display, position, overflow, overflow-x, overflow-y, float, clear, flex-basis, flex-grow, flex-shrink, list-style, list-style-type, list-style-position;
- scoped visual transition: transition, provided every transition component is grammar-valid and contains no resource/function escape.

Property-specific restrictions:

- position allows only static and relative; absolute, fixed, and sticky are dropped to prevent overlaying extension controls.
- background permits only none, transparent, currentColor, or a grammar-valid color; all image/URL forms are dropped.
- CSS custom properties and var() are dropped because their eventual expansion cannot be evaluated reliably at this boundary.
- Numeric lengths may use standard absolute/relative units, percentages, auto, min/max/fit-content, and grammar-valid numeric calc expressions without var() or URLs.
- Colors may be named, transparent/currentColor, hex, rgb/rgba, or hsl/hsla forms.
- display is limited to common content/table/flex/list values, including the fixture's block and inline-flex; it cannot create a shadow/global context.
- !important is preserved because the fixture relies on it and scoping prevents it from winning outside content.
- Declaration and rule order is preserved. Sorting is forbidden because it can change the cascade.

The same parser, allow-list, value checks, and canonical generator apply to inline styles. Regex is a defense-in-depth precheck only and is never the parser or acceptance authority.

### 7.6 Security assertions

Tests must prove:

- script and executable handlers are removed;
- iframe, object, embed, form, input, button, and textarea are removed;
- @import and every CSS url() are removed;
- literal and escaped/obfuscated JavaScript/VBScript CSS forms are removed;
- unsafe inline values are removed;
- malformed or oversized CSS cannot trigger a raw fallback;
- BKU table and heading rules survive;
- global reset selectors match content descendants only;
- toolbar, status, message, and context menu computed styles/selector reach are unchanged;
- one and repeated normalization produce byte-identical canonical output.

## 8. Synchronization state model

### 8.1 State

SyncEngine has these explicit state values:

- disposed: boolean
- timer: timer handle or null
- queuedValue: latest normalized value or absent
- lastSuccessfulValue: last host-confirmed or successfully written normalized value
- inFlightValue: normalized value currently passed to writeValue or absent
- tail: a promise that always settles successfully so later work remains enqueueable
- activeOperation: the externally awaitable current operation, which may reject
- generation: disposal token used to suppress callbacks for stale operations

lastSuccessfulValue changes only after writeValue resolves or after a deliberate host-state alignment on load/refresh/reset/external change. It is never advanced before a write succeeds.

### 8.2 Schedule and debounce

schedule(rawValue):

1. Return without work if disposed.
2. Normalize immediately.
3. Replace queuedValue with the normalized result.
4. Clear an existing timer.
5. Start one timer for debounceMs.
6. When the timer expires, drain the latest queued value. The timer path attaches an explicit terminal rejection handler after onError has run, preventing an unhandled Promise rejection. A caller such as onSaved still receives flush rejection.

Rapid input therefore writes only the final canonical value. An equivalent canonical value is suppressed even when raw markup differs.

### 8.3 Serialized write

Draining captures and clears queuedValue, then appends one operation to tail.

At operation start:

- abort if disposed;
- recheck against lastSuccessfulValue, because an earlier serialized write may now make it redundant;
- set inFlightValue;
- await writeValue.

On success:

- set lastSuccessfulValue;
- clear inFlightValue;
- invoke success only for the current generation.

On failure:

- clear inFlightValue;
- leave lastSuccessfulValue unchanged;
- invoke onError once for the current generation;
- reject the operation to its direct caller;
- assign tail to operation.catch(() => undefined), keeping the serial queue usable.

There is no automatic retry. Scheduling the same value after a failure attempts a new write because it does not equal lastSuccessfulValue.

### 8.4 Echo handling

isEcho(rawValue) normalizes the host value and returns true when it equals:

- lastSuccessfulValue, or
- inFlightValue.

The second case handles hosts that publish changedFields before setFieldValue's promise resolves. A failed operation removes that candidate. A matching echo never calls host.setHtml, so selection and undo state are not reset.

Equality uses the complete canonical normalization from Section 7: browser-normalized element names, lexicographically ordered normal attributes, canonical inline/style CSS, one recreated root, and preserved text/child order. Quote style, attribute order, CSS whitespace, or a host-removed root marker therefore canonicalize back to the same value. Text changes, element changes, class/style loss, and other canonical differences are treated as real external changes and update the UI. Whitespace text nodes are not broadly discarded because whitespace can be meaningful in rich text.

The explicit System.Description Azure regression records the host round trip. If Azure applies a semantically harmless mutation not covered by this comparator and causes editor reset/echo churn, release is blocked until the comparator is amended with focused evidence and user approval. If Azure strips the persisted root marker, local canonical equality may still recognize the echo after recreating the marker, but the explicit-target visual/persistence gate still fails because stored scoped CSS would not be self-contained.

### 8.5 Flush

flush:

- clears the debounce timer;
- immediately enqueues the current queuedValue, if present;
- snapshots the operation chain that existed at the flush call;
- awaits that operation, including a write already in flight;
- resolves only when all values queued before the flush call have succeeded;
- rejects if the relevant write failed.

Thus onSaved cannot report success while a write is in flight or after a swallowed failure.

### 8.6 Disposal

dispose:

- marks disposed and advances generation;
- clears timer and queuedValue;
- prevents queued-but-not-started writes and later callbacks;
- does not claim to cancel an IWorkItemFormService call already executing, because that API is not cancellable.

The no-write-after-dispose test covers pending work that has not entered writeValue. In-flight host calls are documented and awaited only by their original caller.

## 9. Editor, table, UI, and accessibility parity

### 9.1 Editor host

Preserve:

- Bold, Italic, Underline, Bullet, Number, Link, Table, optional Code, Undo, Redo;
- text buttons and order;
- native window.prompt with prompt text Link URL;
- trim URL, no operation on cancel/empty;
- 3 by 3 table insertion;
- Markdown plugin only when enabled;
- Ctrl/Cmd+Shift+8 code-block shortcut;
- Rooster snapshot undo/redo;
- horizontal and vertical content scrolling;
- toolbar flex-wrap.

The editor's canonical content root carries data-rdx-content-root. The editable element receives a descriptive aria-label. Input, keyup, cut, delayed paste, toolbar, shortcut, and table operations converge on one emitChange method. Mount/unmount tests prove one listener set and complete disposal.

### 9.2 Table menu

Preserve the existing command surface and labels:

- Insert: Row Above, Row Below, Column Left, Column Right.
- Delete: Delete Row, Delete Column, Delete Table.
- Merge and split: Merge Cells, Split Columns, Split Rows.
- Cell alignment: Left, Center, Right, Top, Middle, Bottom.
- Table alignment: Left, Center, Right.
- Shading: None, Yellow, Green, Blue, Gray.

Logical grid tests cover rowspan and colspan. Merge is available only for a rectangular multi-cell selection. Last-row/last-column deletion is disabled. The menu clamps to the viewport. Full Width remains present only as unsupported/disabled.

Accessibility additions:

- toolbar role=toolbar and an accessible label;
- status role=status with aria-live=polite;
- context menu role=menu;
- actionable items use role=menuitem;
- opening saves prior focus and focuses the first enabled menu action;
- Arrow Up/Down, Home, End, Enter, Space, and Escape mirror pointer operation;
- close restores focus when the originating cell/element still exists;
- outside pointer, blur, resize, Escape, and dispose remove/close exactly once.

No visual icon, active-format redesign, or modal is added.

## 10. Error handling and visibility

| Failure | User-visible behavior | Telemetry/log behavior | Recovery |
| --- | --- | --- | --- |
| Bootstrap/bridge creation | Existing safe initialization-error text through textContent | notifyLoadFailed with bounded message; no content | Host reload |
| Initial Work Item type/field read during onLoaded | Fatal control message using the existing safe text prefix/style; no partial editor. This is a post-bootstrap lifecycle error, not a host load-notification failure | Controlled console warning/error code; do not call notifyLoadFailed after notifyLoadSucceeded | Refresh/reload |
| Later field read/refresh/reset | Preserve last valid UI; no invented status | Controlled console.warn operation code | Next host event |
| HTML parser/DOMPurify unexpected failure | Empty safe canonical content wrapper | Controlled sanitizer error code; no source content | Next valid load/change |
| CSS parser/policy failure | Keep sanitized HTML; drop rejected CSS | Controlled CSS rejection code/count only | User content remains safe |
| Field write | Autosync failed: {bounded message} | autosync_failure with primitive errorCode | Next user change can write |
| Table command | Preserve current UI/status; command is not applied | Controlled console.warn code | User may choose another action |
| Dispose during async work | No stale UI/status callback | No content log | New lifecycle generation |

Table-command errors remain console.warn-only during parity. Showing them in the autosync status would conflate editing and persistence state and is a new UX decision; it remains P2.

User-facing error formatting takes Error.message only, removes control/newline characters, caps length, and substitutes a stable generic message for unknown values. It never renders stack, name plus stack, JSON-serialized errors, host objects, HTML, or CSS. Bootstrap and message views use textContent.

Only failures before notifyLoadSucceeded call notifyLoadFailed. Lifecycle callbacks run after successful registration; their failures are contained inside the controller and never attempt to reverse the SDK load notification.

## 11. Testing strategy

### 11.1 Characterization first

Before replacement code:

- reconstruct test/fixtures/bku-template.html from the exact HTML/CSS text payload represented by DOCX OOXML text runs;
- record its provenance, text-payload checksum, and the limitation that no original standalone HTML bytes/container metadata were embedded;
- freeze current config parsing, exact strings, event names, toolbar labels/order, table labels/states, manifest contract, and host call order;
- create an acceptance matrix mapping legacy output, approved intentional hardening, and rewrite output.

Intentional hardening differences are limited to:

- scoped and filtered CSS;
- canonical data-rdx-content-root wrapper;
- blocked implicit System.Description writes;
- correct write-failure recovery and save flush;
- safe bounded errors and runtime telemetry validation;
- accessibility semantics without visual changes;
- whitespace-only native link-prompt input becoming a no-op after trimming, as required by the editor work package;
- deterministic release/harness tooling.

Every implementation task follows red-green-refactor: add a focused failing test, demonstrate the expected failure, implement the minimum, rerun focused and broader tests, then commit the independently complete task.

### 11.2 Unit tests

- Configuration: all/missing/empty inputs, debounce variants, Boolean variants, WIT trimming/case, immutability, fieldNameWasExplicit.
- Sanitizer: HTML removal, URI handling, CSS AST failures, selector mapping, declaration allow-list, inline policy, @media print, oversize aggregate, one wrapper, idempotency, BKU structure.
- SyncEngine: single/rapid changes, timer reset, latest value, serial controlled promises, same canonical suppression, in-flight and successful echo, flush while queued/in flight, dispose, fail-then-success.
- WorkItemBridge: service acquisition, null handling, type read, exact field write, own-property changed-field filtering.
- Table selection/menu: normal and merged grids, state, boundaries, clamping, keyboard, focus, disposal.
- Code block: current shortcut/helper behavior and pinned Rooster contract.
- Telemetry: exact events, metadata, primitive runtime filter, bounded errors, content exclusion.

### 11.3 Component tests

- RoosterHost toolbar order/actions and conditional buttons.
- Change propagation for input, keyup, cut, paste, toolbar, shortcut, and table actions.
- Native prompt cancel/empty/trim behavior.
- Snapshot undo/redo.
- TableContextMenu pointer and keyboard behavior.
- Read-only preview and statuses.
- Repeated mount/dispose without duplicate/global listeners.

Vitest/jsdom tests mock layout values for deterministic menu clamping. Actual wrapping, scrolling, focus, and CSS isolation are also inspected in the local browser harness.

### 11.4 Integration tests

- SDK init/ready/register/notify order and bootstrap failure.
- Editable, read-only, unsupported WIT, and unloaded branches.
- Target and non-target changedFields.
- Autosync plus immediate/delayed echo.
- Save flush before debounce and during in-flight write.
- Refresh/reset host alignment.
- Unload/reload generation isolation.
- Initial read and write failures.
- Explicit custom-field independence from System.Description.
- Explicit System.Description canonical operation.

### 11.5 Acceptance matrix

| ID | Automated evidence | Additional evidence |
| --- | --- | --- |
| AC-01 | Editable lifecycle component/integration | Harness screenshot |
| AC-02 | Unsupported-WIT integration: no field read/editor/sync/write | Harness state |
| AC-03 | Read-only integration: preview only, no sync/write | Harness state |
| AC-04 | BKU sanitizer golden/DOM/style assertions | Harness screenshot |
| AC-05 | CSS security unit corpus | Audit record |
| AC-06 | Fake timers and controlled writes | Mock host log |
| AC-07 | In-flight/successful echo integration | Mock host/editor call log |
| AC-08 | Queued and in-flight save flush tests | Mock save log |
| AC-09 | Table menu state component tests | Harness interaction |
| AC-10 | Fail-then-success controlled promise test | Status/telemetry assertions |
| AC-11 | Custom-field integration with forbidden Description write assertion | Real ADO field log/hash |
| AC-12 | Non-target event no-read/no-UI test | Mock host log |
| AC-13 | Scoped-selector and shell reach tests | Before/after harness screenshot |
| AC-14 | BKU global reset selector tests | Computed-style/manual browser inspection |
| AC-15 | Repeat normalization/save/refresh/reopen comparison | Real ADO canonical/hash evidence |

### 11.6 Local harness

In the target state, development Webpack will emit both dist/control.js and dist/test-harness.js. Production Webpack will emit only dist/control.js after cleaning dist. test.html will continue to reference dist/test-harness.js and will be valid after npm run build:harness. The current one-entry Webpack configuration does not yet satisfy this target.

The harness imports production modules and provides:

- BKU fixture loading;
- editable/read-only toggle;
- WIT and input simulation;
- target field selection;
- changedFields, save, refresh, reset, unload, and reload controls;
- a visible mock-host debug panel;
- separate Custom.RoosterContent and System.Description values/hashes;
- a write log proving target-only writes;
- representative narrow Azure DevOps widths for wrap/scroll inspection.

It is never referenced by static/control.html or the production contribution and is excluded from the production VSIX by the clean production build.

### 11.7 Real Azure DevOps release regression

This manual/environmental gate cannot be substituted by mocks:

1. Package the private 0.1.21 release candidate.
2. Install it in an authorized Azure DevOps test organization/collection.
3. Bind FieldName to a custom HTML field and include standard System.Description on the same Work Item.
4. Put the reconstructed BKU HTML/CSS text payload in System.Description and record its fixture checksum/provenance.
5. Capture before screenshot, raw Description field value and SHA-256 from IWorkItemFormService, table count, heading selectors/styles, and browser console. A normalized hash may be recorded only as a secondary diagnostic.
6. Enter s only into the extension custom field.
7. Wait past debounce, save, refresh, close, and reopen.
8. Capture after evidence and the setFieldValue log.
9. Require exact raw Description string equality and matching raw SHA-256 because this scenario does not target Description. A normalized comparison cannot replace this oracle or hide host reformatting.
10. Require no visual difference, unchanged table count/borders/typography/colors, only custom-field writes, and no runtime console errors.

A second authorized scenario explicitly targets System.Description and verifies the canonical wrapper, scoped rules, save/refresh stability, and host preservation of data-rdx-content-root. Canonical DOM/style comparison is allowed only for this explicit-target scenario and its reason is recorded.

If the authorized host/test tooling cannot expose the raw Description field string for the custom-field scenario, the release remains blocked until the user approves a different oracle. Without installation authority and a signed-in test organization/collection, the release also remains blocked. Neither condition can be reported as complete.

## 12. Build, CI, packaging, and release

### 12.1 Deterministic scripts

The approved implementation plan will define scripts equivalent to:

- clean: remove dist and artifacts generated by this project;
- typecheck: strict no-emit source/test type checking;
- test: deterministic Vitest run;
- build: clean production build, control entry only;
- build:harness: clean development build with control and test-harness entries;
- package:vsix: production build, contract/version checks, tfx packaging to artifacts, VSIX verification;
- verify: typecheck, tests, production build, harness build, package checks;
- audit:prod: production dependency audit.

Exact paths replace broad globs in cleaning and verification. node_modules, dist, artifacts, VSIX files, macOS metadata, and platform binaries remain ignored.

### 12.2 One release version source

vss-extension.json.version is the single release input because this repository produces an Azure DevOps extension and tfx packages that manifest directly. Its existing 0.1.21 value remains the first parity-candidate version.

A deliberate release-preparation script reads that one value and synchronizes package.json.version plus the root package/package-lock metadata. Developers do not edit those mirror values independently. The synchronization command is run and committed when preparing a version; normal build/package commands are read-only and fail if the mirrors are stale. For the first parity candidate it changes the current package mirror from 0.1.0 to 0.1.21.

A release checker fails if:

- package.json or the package-lock root version differs from vss-extension.json.version;
- any immutable identity/scope/contribution value differs;
- the produced VSIX manifest version differs from vss-extension.json.version.

This satisfies both requirements: one human-edited release value and aligned tracked/package/VSIX metadata. No generated packaging manifest or hidden second version source is introduced.

### 12.3 VSIX content

Packaging always runs a clean production build first. The verifier opens/lists the VSIX and requires:

- static/control.html;
- static/control.css;
- dist/control.js;
- matching 0.1.21 metadata;
- unchanged identity and only vso.work_write.

It rejects:

- dist/test-harness.js;
- test.html;
- src, test, fixtures, docs, node_modules, maps not intentionally approved, credentials, environment files, archive junk, and platform binaries.

The expected artifact is stored under ignored artifacts with a deterministic identity/version-derived name. The release report records filename and SHA-256.

### 12.4 CI

Add a Linux CI workflow using the project-supported Node 24 line. It runs from a fresh checkout:

1. npm ci
2. strict typecheck
3. all unit/component/integration tests
4. production build
5. harness build and file assertion
6. production audit
7. VSIX package and content verification
8. clean tracked-tree assertion

The build remains browser-only and makes no runtime network request. Development vulnerability findings are reviewed package by package; compatible toolchain upgrades are tested rather than applying a blind npm audit fix. A known production vulnerability blocks release unless a specific documented disposition is approved.

### 12.5 Bundle and release controls

- Compare dist/control.js to the 537,439-byte baseline.
- Attribute growth to css-tree, DOMPurify, or code changes in the release report.
- Keep RoosterJS at 9.45.2 during parity.
- Do not add code splitting unless measurements show a real Azure DevOps load benefit and the user separately approves the complexity.
- Create release notes with behavior preservation, security changes, version, tests, Azure evidence, upgrade, and rollback.
- Rollback means uninstall/disable the release candidate and reinstall the last known private VSIX; no data migration exists.
- Mark 0.1.21 as a release candidate only after every automated gate and the real Azure DevOps gate passes.

### 12.6 Completion evidence report

The final implementation report follows the requested evidence structure:

1. Result summary: changes, preserved behavior, resolved problems, and intentional exclusions.
2. Changed files: absolute/repository path, responsibility, and reason for every file.
3. Test results: fresh actual output and pass/fail/skip counts for npm ci, npm test, npm run build, and npm run package:vsix, plus typecheck/harness/audit checks.
4. Regression evidence: before/after screenshots, raw Description comparison/hash, custom-field write log, DOM/style checks, and browser-console result.
5. Release artifact: VSIX filename, SHA-256, package/manifest/VSIX versions, identity/scope, and content verification.
6. Assumptions: every unverified Azure DevOps/environment behavior.
7. Remaining risks: only genuine unresolved risks; an unexecuted check is never represented as passed.
8. Git evidence: git status --short and git log --oneline --decorate -n 20.
9. Completion verification: every fresh command/result executed under verification-before-completion.

## 13. Implementation sequence after approval

Approval of this design authorizes writing the separate implementation plan, not immediate unplanned coding. The plan follows this order:

1. Characterization tests, BKU fixture, and acceptance matrix.
2. Clean cross-platform build, harness, CI, and release foundation.
3. Configuration and WorkItemBridge tests/replacements.
4. Field-independence integration test.
5. Sanitizer/CSS security tests and replacement.
6. SyncEngine state tests and replacement.
7. RoosterHost and code-block tests/replacement.
8. Table selection/menu tests/replacement.
9. Lifecycle, statuses, telemetry, and error tests/replacement.
10. Full local gates, VSIX validation, reviews, and release notes.
11. Authorized real Azure DevOps regression and release-candidate evidence.

Each independently complete task gets its own test-first commit. Every work package receives specification-compliance review followed by code-quality review. Sanitizer, SyncEngine, lifecycle, and table-menu packages are suitable for independent subagents after their interfaces and tests are committed.

## 14. Release gates

Release is blocked unless all are true:

- clean npm ci succeeds on Linux;
- strict source/test typecheck succeeds;
- all unit, component, and lifecycle integration tests pass;
- production and harness builds succeed;
- package:vsix succeeds;
- package, effective manifest, and VSIX versions are 0.1.21;
- immutable identity/scope values pass;
- production audit has no unapproved known vulnerability;
- BKU structure/style/security/idempotency tests pass;
- explicit custom-field/System.Description independence passes;
- real Azure DevOps before/after regression passes;
- no read-only write path exists;
- unsupported WIT creates no target read/editor/sync/write path;
- no echo loop exists;
- save flush loses no queued/in-flight value;
- template CSS cannot reach chrome;
- telemetry contains no content;
- production VSIX excludes harness/source/tests/fixtures/secrets;
- bundle growth is measured/explained;
- Git contains no unexpected generated files;
- specification and code-quality reviews are complete;
- verification-before-completion evidence is fresh and recorded.

## 15. Assumptions and approval decisions

### 15.1 Verified assumptions

- The three archives are repackagings of the same meaningful source, not independent implementations.
- The two available project PDFs are identical copies.
- The exact HTML/CSS text payload can be reconstructed from DOCX OOXML text runs. There is no embedded standalone HTML part, so original standalone-file bytes, filename, container metadata, and encoding context cannot be recovered.
- Clean local tests/build pass; old copied node_modules failures are not current source failures.

### 15.2 Host-dependent assumptions that remain release gates

- Azure DevOps preserves data-rdx-content-root in the configured HTML field.
- Host field-change timing may occur before or after setFieldValue resolves; in-flight echo matching covers both.
- IWorkItemFormService provides no cancellation for a write already in progress.
- Exact browser layout and private extension installation require an authorized test organization/collection.

### 15.3 Explicit approval requested

Approval must include these decisions:

1. Parallel branch-isolated, module-by-module behavior-equivalent rewrite.
2. Add exact css-tree 3.2.1 and development types 3.2.0.
3. Upgrade/pin DOMPurify to 3.4.13 and require a clean production audit.
4. Persist exactly one neutral data-rdx-content-root wrapper in canonical field HTML.
5. Preserve the System.Description parser default but deny read/editor/sync/write initialization when raw FieldName was absent/empty.
6. Keep table-command failures console-only during parity.
7. Use vss-extension.json.version as the single release input and synchronize/validate package.json plus package-lock mirrors at 0.1.21.
8. Add the nonvisual roles, focus restoration, and keyboard menu behavior explicitly required by the accessibility work package.
9. Treat a whitespace-only native link-prompt value as empty after trimming and perform no insertion.

## 16. P2 backlog excluded from parity

- autosync retry button and backoff;
- custom link dialog;
- toolbar icon/active-format system;
- loading/empty states;
- localization;
- external telemetry/monitoring/correlation IDs;
- configurable height or mobile-specific redesign;
- version history/collaboration;
- file/image upload;
- backend, database, admin panel.

## 17. Design-stage completion boundary

At this stage, the only repository change is this design document. No fixture, dependency, source, test, build, manifest, or release file is changed. Implementation planning begins only after explicit user approval of Section 15.3.
