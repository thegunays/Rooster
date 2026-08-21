# Azure DevOps regression evidence runbook

## Status and authorization boundary

This runbook defines the two real Azure DevOps release regressions for version `0.1.21`. It does not record an Azure run. Local synthetic evidence proves only that the evidence tooling works.

Run these scenarios only when all of the following are true:

- the user has explicitly approved installing the private pre-gate test artifact and mutating test Work Items;
- the target is a private, non-production Azure DevOps test organization/collection;
- the operator is signed in with only the permissions required for the approved test;
- the exact `0.1.21` pre-gate test artifact being evaluated has been installed in that test organization/collection;
- the Work Item contains both a custom HTML field named `Custom.RoosterContent` and the standard `System.Description` field.

Do not run this procedure against production data. Do not label a local fixture, mocked run, or harness run as `azure-host`. If installation approval, a signed-in test organization/collection, or raw field access is unavailable, stop: the release remains blocked.

## Evidence directory and path rule

Create one untracked working directory per authorized run outside the committed `docs/regression/evidence/.gitkeep` placeholder. Protect any captured Work Item content according to the test organization's data-handling rules.

Every path in an evidence JSON file is resolved relative to the directory containing that JSON file. Paths must use forward slashes, be non-empty normalized relative paths, remain inside that directory, and contain no empty, `.`, `..`, backslash, or symbolic-link component. The JSON itself and every referenced target must be a regular non-symlink file. The verifier rejects any other path form rather than guessing which file was intended.

Recommended layout:

```text
authorized-run/
  custom-field.json
  explicit-system-description.json
  custom-field/
    before-description.html
    after-description.html
    before.png
    after.png
  explicit-description/
    before.html
    after-save.html
    after-refresh.html
    after-reopen.html
    before.png
    after.png
```

Paths in each JSON file must be written relative to `authorized-run/`, for example `custom-field/before-description.html`.

## Fixed BKU oracle

Use the repository fixture without normalization, line-ending conversion, or copy/paste substitution:

```text
test/fixtures/bku-template.html
UTF-8 bytes: 10423
SHA-256: 0005e3eff97cc3aa39bbb2d90aa5b6f76b4435eb4b679d5ae3e1182b61c24b2a
```

Verify the source immediately before the run:

```bash
wc -c test/fixtures/bku-template.html
shasum -a 256 test/fixtures/bku-template.html
```

The output must be exactly `10423` bytes and the digest above. A different result blocks the run.

Capture raw values directly from `IWorkItemFormService` as the exact returned strings encoded once as UTF-8 files. Do not pass them through an HTML parser, serializer, formatter, editor getter, clipboard, newline converter, or sanitizer. Hash the resulting file bytes with `shasum -a 256`. A normalized or semantic hash may be retained as a diagnostic, but it never replaces a required raw-byte comparison.

For every before and after checkpoint, capture and record:

- the raw field value file and its SHA-256;
- a genuine screenshot of the same visible state;
- DOM structure and an exact table count;
- representative heading typography, table/cell borders, and colors;
- the `setFieldValue` log with field names and write counts;
- browser-console errors from a cleared console covering the complete scenario.

Set a JSON comparison flag to `true` only after the corresponding observation was actually made and matched. The final `consoleErrors` value must be an empty array.

## Scenario 1: custom-field independence

1. On a fresh approved test Work Item, place the exact BKU fixture in `System.Description`.
2. Configure the extension contribution with `FieldName=Custom.RoosterContent`. Keep the standard Description control visible on the same Work Item.
3. Clear the browser console and field-write log.
4. Read `System.Description` directly through `IWorkItemFormService`. Save the exact returned string as `custom-field/before-description.html`, calculate its SHA-256, and capture the before screenshot, DOM, six-table count, heading typography, borders, and colors.
5. Focus only the extension's custom-field editor and type the single character `s`. Make no other edit.
6. Wait longer than the configured debounce interval. Save the Work Item, refresh it, close it, and reopen it.
7. Read `System.Description` directly again and save it as `custom-field/after-description.html`. Capture the corresponding screenshot, DOM, six-table count, heading typography, borders, colors, complete write log, and console errors.
8. Run the raw oracle before creating evidence JSON:

   ```bash
   cmp -s authorized-run/custom-field/before-description.html authorized-run/custom-field/after-description.html
   shasum -a 256 authorized-run/custom-field/before-description.html authorized-run/custom-field/after-description.html
   ```

   `cmp` must exit `0`, and both SHA-256 values must be identical. Any byte difference fails the scenario even if parsed, normalized, or rendered HTML appears equivalent.
9. Confirm the write log contains at least one `Custom.RoosterContent` target write and exactly zero `System.Description` writes. Confirm both captures contain exactly six tables, all four visual/DOM comparisons match, both screenshot files exist, and `consoleErrors` is empty.

Create `authorized-run/custom-field.json` with exactly these fields and actual captured values:

```json
{
  "extensionVersion": "0.1.21",
  "evidenceKind": "azure-host",
  "scenario": "custom-field",
  "beforeRawPath": "custom-field/before-description.html",
  "beforeRawSha256": "<actual lowercase SHA-256>",
  "beforeTableCount": 6,
  "afterTableCount": 6,
  "headingStyleMatch": true,
  "borderStyleMatch": true,
  "colorStyleMatch": true,
  "domStructureMatch": true,
  "descriptionWriteCount": 0,
  "targetWriteCount": 1,
  "consoleErrors": [],
  "beforeScreenshot": "custom-field/before.png",
  "afterScreenshot": "custom-field/after.png",
  "afterRawPath": "custom-field/after-description.html",
  "afterRawSha256": "<actual lowercase SHA-256>"
}
```

Use the observed target-write count when it is greater than one; do not force it to match the example.

## Scenario 2: explicit `System.Description`

Use a fresh approved Work Item or reset the prior Work Item to the exact BKU fixture before this scenario.

1. Explicitly configure the extension contribution with `FieldName=System.Description`.
2. Clear the browser console and field-write log.
3. Read the exact pre-edit `System.Description` string through `IWorkItemFormService`, save it as `explicit-description/before.html`, hash it, and capture the before screenshot, DOM, six-table count, heading typography, borders, and colors.
4. Focus the extension editor and type the single character `s`. Make no other edit.
5. Wait longer than the configured debounce interval and save the Work Item. Immediately read the raw field through `IWorkItemFormService` into `explicit-description/after-save.html`.
6. Refresh the Work Item and capture the raw field into `explicit-description/after-refresh.html`.
7. Close and reopen the Work Item, then capture the raw field into `explicit-description/after-reopen.html` and take the after screenshot.
8. Hash each raw capture and run the canonical byte oracle:

   ```bash
   cmp -s authorized-run/explicit-description/after-save.html authorized-run/explicit-description/after-refresh.html
   cmp -s authorized-run/explicit-description/after-save.html authorized-run/explicit-description/after-reopen.html
   shasum -a 256 authorized-run/explicit-description/after-save.html authorized-run/explicit-description/after-refresh.html authorized-run/explicit-description/after-reopen.html
   ```

   Both `cmp` commands must exit `0`, and all three hashes must be identical. The intended edit means the before capture is not required to equal the canonical after captures.
9. Inspect both the saved and reopened raw HTML independently. Each must contain exactly one direct top-level `<div data-rdx-content-root="">` marker, the marker value must be empty, that root must have no other attributes, and no nested or additional marker may exist. The refresh capture must be byte-identical to those captures.
10. Parse every retained stylesheet rule in the saved, refreshed, and reopened raw captures. Every selector branch must start at the neutral `[data-rdx-content-root]` marker and remain within it; sibling escapes such as `[data-rdx-content-root] ~ .outside` fail. Do not use a regex-only or visual-only selector check.
11. Confirm every capture has exactly six tables; heading typography, borders, colors, and DOM structure match; the write log has at least one target write and at least one `System.Description` write; both screenshots exist; and the complete console error list is empty.

Create `authorized-run/explicit-system-description.json` with exactly these fields and actual captured values:

```json
{
  "extensionVersion": "0.1.21",
  "evidenceKind": "azure-host",
  "scenario": "explicit-system-description",
  "beforeRawPath": "explicit-description/before.html",
  "beforeRawSha256": "<actual lowercase SHA-256>",
  "beforeTableCount": 6,
  "afterTableCount": 6,
  "headingStyleMatch": true,
  "borderStyleMatch": true,
  "colorStyleMatch": true,
  "domStructureMatch": true,
  "descriptionWriteCount": 1,
  "targetWriteCount": 1,
  "consoleErrors": [],
  "beforeScreenshot": "explicit-description/before.png",
  "afterScreenshot": "explicit-description/after.png",
  "afterSaveRawPath": "explicit-description/after-save.html",
  "afterRefreshRawPath": "explicit-description/after-refresh.html",
  "afterReopenRawPath": "explicit-description/after-reopen.html",
  "afterSaveRawSha256": "<actual lowercase SHA-256>",
  "afterRefreshRawSha256": "<actual lowercase SHA-256>",
  "afterReopenRawSha256": "<actual lowercase SHA-256>",
  "canonicalRootAfterSave": true,
  "canonicalRootAfterReopen": true,
  "allStyleSelectorsScoped": true
}
```

Use the actual observed write counts when they differ from the example.

## Verification commands and release decision

Default mode accepts either evidence kind and conspicuously labels local evidence:

```bash
node scripts/verify-regression-evidence.mjs authorized-run/custom-field.json
node scripts/verify-regression-evidence.mjs authorized-run/explicit-system-description.json
```

The external release gate must use Azure-host enforcement for both files:

```bash
node scripts/verify-regression-evidence.mjs --require-azure-host authorized-run/custom-field.json
node scripts/verify-regression-evidence.mjs --require-azure-host authorized-run/explicit-system-description.json
```

Both enforced commands must exit `0`. Any verifier failure, byte difference, hash mismatch, missing capture or screenshot, missing raw-field access, non-target write, visual/DOM/table difference, root/scoping failure, console error, or unverifiable observation blocks release. Do not replace a failed raw oracle with canonicalization, normalized equality, visual similarity, or local synthetic evidence.
