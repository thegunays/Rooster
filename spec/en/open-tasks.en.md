# Open Tasks (EN)

Originally recorded: 2026-03-30
Current-state correction: 2026-08-20

## High Priority

- After explicit user approval, execute the two real Azure DevOps scenarios in `docs/regression/azure-devops-regression.md` against a private non-production organization and retain the required raw-field, visual, write-log, and console evidence.

## Medium Priority

- Improve telemetry beyond console-only output with an opt-in sink and privacy-safe fields.
- Add deployment and contribution-configuration examples per Work Item type.
- Validate the autosync failure status experience in a real host and complete the still-pending local-browser AC-10 evidence.
- Evaluate responsive or configurable control sizing beyond the current fixed height of `570`.

## Low Priority

- Evaluate replacing `window.prompt` link insertion with inline dialog UX.

## Completed Current-State Coverage

- Controller load, field-change, save, refresh, reset, unload, reload, failure, overlap, echo, and read-only lifecycle contracts have deterministic component/integration coverage.
- Table-menu state, dispatch, keyboard behavior, merged/split selection edge contracts, and a live local keyboard path are covered.
- Read-only rendering and local visual regression captures are complete; they remain local rather than Azure-host evidence.
- The current lifecycle harness and local release-integrity/package gate are implemented.

## Definition of Done Guidance

Every task must include:

1. Observable behavior contract
2. Test coverage impact
3. Rollback strategy
4. Worklog entry
