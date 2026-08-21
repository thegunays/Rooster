# Agent Working Rules (EN)

Date: 2026-03-30

## Purpose
Define safe and efficient agent collaboration rules for ongoing development sessions.

## Rules
1. Never revert unrelated local changes.
2. Prefer small, reversible edits with explicit rationale.
3. Update `worklog` after each meaningful change set.
4. Track decisions in `decisions` before large refactors.
5. Record what was tested, how, and what remained untested.
6. Respect architecture seams (control vs bridge vs sync vs sanitizer).
7. Avoid direct DOM shortcuts that bypass editor model APIs for content operations.

## Session Handoff Protocol
- Start with `session-summary` + `open-tasks`.
- Confirm assumptions in one paragraph.
- Execute one vertical slice at a time.
- End with updated `worklog` and `testing` entries.
