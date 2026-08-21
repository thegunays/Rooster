# Azure DevOps Server 2022 Input Contract Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a new VSIX whose work-item-control inputs are discovered and rendered by Azure DevOps Server 2022, allowing `SDK.getConfiguration().witInputs.FieldName` to be populated.

**Architecture:** Keep the runtime bootstrap safety check unchanged. Correct the extension boundary instead: use the Server-2022-compatible Microsoft manifest structure, lock it with an independent characterization assertion, mirror it in the release contract, then bump and rebuild the artifact so the server cannot reuse the invalid 0.1.22 contribution metadata.

**Tech Stack:** Azure DevOps extension manifest v1, `tfx-cli@0.23.1`, TypeScript 5.9, Vitest 4, Node.js 24.

**Spec:** [Microsoft multivalue-control manifest](https://github.com/microsoft/vsts-extension-multivalue-control/blob/0f047c876102/azure-devops-extension.json#L65-L119) and [Microsoft Azure DevOps custom-control input contract](https://learn.microsoft.com/en-us/azure/devops/extend/develop/custom-control?view=azure-devops).

## Global Constraints

- Target Azure DevOps Server 2022 and its inherited-process custom-control configuration UI.
- Keep `FieldName` required and restricted to `HTML` work-item fields.
- Keep runtime rejection of an absent/blank `witInputs.FieldName` unchanged.
- Keep the extension private with sole scope `vso.work_write`.
- Use `vss-extension.json.version` as the release version source and synchronize package mirrors through `scripts/sync-release-version.mjs`.
- This extracted workspace has no `.git` metadata; do not create commits.

---

### Task 1: Lock the Server 2022 Manifest Contract

**Files:**
- Modify: `test/characterization/manifest-contract.test.ts`
- Modify: `test/release/releaseContract.test.ts`

**Interfaces:**
- Consumes: the source `vss-extension.json` and `validateReleaseContract()`.
- Produces: an independent test contract requiring `contribution.properties.inputs` and rejecting root-level `contribution.inputs`.

- [x] **Step 1: Write the failing characterization assertion**

Require the control contribution to have no own `inputs` property and require `properties.inputs[0]` to equal:

```ts
{
  id: "FieldName",
  description: "Target field reference name.",
  type: "WorkItemField",
  properties: { workItemFieldTypes: ["HTML"] },
  validation: { dataType: "String", isRequired: true }
}
```

Require the four generic inputs to omit `type` and use `validation.dataType: "String"`.

- [x] **Step 2: Run RED**

Run: `npm test -- test/characterization/manifest-contract.test.ts --reporter=verbose`

Expected: FAIL because the current manifest has root-level `inputs`, `validation.dataType: "WorkItemField"`, and `validation.properties`.

- [x] **Step 3: Add release-contract mutation coverage**

Update the controlled fixture to the desired shape, then assert that moving `inputs` to the contribution root, moving `workItemFieldTypes` under `validation`, or changing `dataType` to `WorkItemField` yields `MANIFEST_CONTRACT_INVALID`.

### Task 2: Correct the Source and Release Manifest

**Files:**
- Modify: `vss-extension.json`
- Modify: `scripts/lib/release-contract.mjs`

**Interfaces:**
- Consumes: the failing contract from Task 1.
- Produces: a source/release manifest whose control properties contain all five inputs in the Microsoft Server 2022-compatible shape.

- [x] **Step 1: Apply the minimal manifest correction**

Move the five inputs into `contributions[0].properties.inputs`. For `FieldName`, keep `type: "WorkItemField"`, move `workItemFieldTypes` to input-level `properties`, and use `validation.dataType: "String"`. Remove `type` from the four generic string inputs.

- [x] **Step 2: Mirror the corrected shape in the release contract**

Update `expectedManifest()` with the same literal structure so packaging rejects future drift.

- [x] **Step 3: Run GREEN**

Run: `npm test -- test/characterization/manifest-contract.test.ts test/release/releaseContract.test.ts --reporter=verbose`

Expected: both files pass with zero failures.

### Task 3: Version and Package a Cache-Distinct Artifact

**Files:**
- Modify: `vss-extension.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `test/characterization/manifest-contract.test.ts`
- Modify: `test/release/vsixContract.test.ts`
- Modify: `test/release/realVsix.integration.test.ts`

**Interfaces:**
- Consumes: corrected manifest/release contract.
- Produces: `artifacts/ygdb121.roosterjs-description-editor-0.1.23.vsix` with aligned 0.1.23 identity.

- [x] **Step 1: Bump the manifest source version**

Set `vss-extension.json.version` to `0.1.23`, then run `node scripts/sync-release-version.mjs` to update package mirrors.

- [x] **Step 2: Update real-artifact test literals**

Change only literals tied to the repository artifact from `0.1.22` to `0.1.23`; keep self-contained historical/future-version fixtures deliberately distinct.

- [x] **Step 3: Package and inspect**

Run: `npm run package:vsix`

Then inspect `extension.vsomanifest` and require:

```text
contributions[0].properties.inputs exists
contributions[0].inputs is absent
FieldName.properties.workItemFieldTypes == ["HTML"]
FieldName.validation == { dataType: "String", isRequired: true }
```

### Task 4: Full Verification

**Files:**
- Verify only; no additional production changes.

**Interfaces:**
- Consumes: the 0.1.23 source and artifact.
- Produces: fresh evidence for handoff.

- [x] **Step 1: Run all gates**

Run:

```bash
npm run typecheck
npm test
npm run check:release
node scripts/verify-vsix.mjs
npm run audit:prod
```

Expected: every command exits zero; Vitest reports 27 passing files and 656 or more passing tests.

- [x] **Step 2: Record installation procedure**

Uninstall 0.1.22, install the 0.1.23 VSIX, remove the existing Rooster control instance from the SRS layout, add it again, set `FieldName=System.Description` and `EnabledWits=SRS,HLD`, save the inherited process, hard-refresh, and reopen the work item.
