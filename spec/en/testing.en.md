# Testing Strategy (EN)

Originally recorded: 2026-03-30
Current-state correction: 2026-08-20

## Current Layers

- Unit and component suites cover configuration, HTML/CSS sanitization, synchronization, controller lifecycle, Rooster host behavior, table selection/menu behavior, telemetry boundaries, and bounded public errors.
- Integration suites run the production controller/editor modules against `FakeWorkItemHost`, including editable, unsupported-WIT, read-only, field independence, save/refresh/reset/unload/reload, echo, and failure recovery.
- Release suites freeze regression-evidence, release-version, package-source, raw ZIP, effective manifest, payload-byte, and pinned real-`tfx` contracts.
- The local browser harness provides synthetic lifecycle and visual evidence. It does not replace real Azure DevOps validation.

Current volatile counts and measured release results live in `docs/releases/0.1.21-pre-gate.md`; acceptance status lives in `docs/acceptance-matrix.md`.

## Quality Gates

```bash
npm run typecheck
npm test -- --reporter=verbose
npm run build
npm run check:build-outputs -- production
npm run build:harness
npm run check:build-outputs -- harness
npm run audit:prod
npm run package:vsix
```

- New behavior requires a deterministic automated test.
- Bug fixes start from a reproducing failure when feasible.
- Production and harness outputs must satisfy their separate exact contracts.
- Packaging must pass the read-only release contract and raw/effective VSIX verifier.
- Real Azure evidence remains a separately authorized external gate.
