# Local UI Harness Guide (EN)

Originally documented: 2026-04-01
Current-state update: 2026-08-20

## Purpose

Run the production configuration, sanitizer, synchronization, editor, read-only view, and controller modules against `FakeWorkItemHost` without an Azure DevOps runtime.

## Files And Responsibilities

- `test.html` mounts `#app` and loads `dist/test-harness.js`.
- `src/test-harness.ts` provides configuration controls, lifecycle actions, a control preview, raw field values, SHA-256 field diagnostics, and a fake-host read/write log.
- `test/support/FakeWorkItemHost.ts` is the synthetic Work Item boundary.
- `webpack.config.js` emits the harness-only development entry. The production output contract excludes it.

## How To Run

1. Build and validate the harness output:

   ```bash
   npm run build:harness
   npm run check:build-outputs -- harness
   ```

2. Start a loopback-only static server from the repository root:

   ```bash
   python3 -m http.server 4173 --bind 127.0.0.1
   ```

3. Open `http://127.0.0.1:4173/test.html` and stop the server after the check.

## Current Harness Behavior

- Configure `FieldName`, Work Item type, read-only state, narrow preview, and write-echo timing.
- Exercise Load, Load BKU, Field change, Save, Refresh, Reset, Unload, and Reload through the production controller lifecycle.
- Inspect the custom field and `System.Description` independently through raw-value, SHA-256, read, and write diagnostics.
- Exercise the real editor toolbar and table menu when editable, or the production read-only view when read-only.

The detailed recorded local scenarios and screenshots are in `docs/regression/local-harness.md`.

## Limits

This is synthetic local evidence. It does not exercise the Azure DevOps SDK runtime, real contribution loading, organization permissions, extension installation, or real Work Item persistence. The two Azure-host scenarios remain `pending external approval and execution` under `docs/regression/azure-devops-regression.md`.
