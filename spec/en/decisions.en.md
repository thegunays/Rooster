# Decisions (EN)

Date: 2026-03-30
Perspective: Harness Engineering + continuous handover readiness

## ADR-001: Modular Spec Set
Decision: Replace two monolithic docs with role-based operational files (session summary, open tasks, decisions, testing, agents, worklog) in EN/TR.
Rationale: Faster onboarding, easier session resumption, and lower context-loss risk.
Status: Accepted.

## ADR-002: Keep Host/Bridge/Sync Separation
Decision: Preserve architecture split (`RoosterDescriptionControl` orchestrator, `WorkItemBridge`, `SyncEngine`, `Sanitizer`, `RoosterHost`).
Rationale: Clear seams for testing, safer change impact boundaries.
Status: Accepted.

## ADR-003: Security-First HTML Pipeline
Decision: Sanitize on inbound render and outbound persistence.
Rationale: Defense in depth against unsafe markup.
Status: Accepted.

## ADR-004: Debounced Serialized Writes
Decision: Keep debounce + write serialization + echo suppression.
Rationale: Avoid host write storms and self-trigger loops.
Status: Accepted.

## ADR-005: Table Menu Through Editor APIs
Decision: Route table operations through Rooster APIs (not direct ad-hoc DOM mutations).
Rationale: Preserve editor model integrity and sync reliability.
Status: Accepted.
