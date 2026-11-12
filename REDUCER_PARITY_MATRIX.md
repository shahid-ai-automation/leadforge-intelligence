# Reducer parity and controlled extraction record

## Source and implementation

Pinned behavioral source: Development Remix
`src/components/outbound-intelligence/state.ts` at commit
`d84685707d15a5f23321d35bdc3f9ddc7a950386`.

The source remains read-only. The repository contains three separate artifacts:
- `packages/leadforge-core/src/reference/pinned-reducer.oracle.ts`: test-only source-derived oracle with documented fixture and deterministic metadata injection.
- `packages/leadforge-core/src/reference/reducer-harness.ts`: independent fixture-free behavioral harness retained for reference.
- `packages/leadforge-core/src/reducer.ts`: standalone extracted core reducer implementation, now publicly exported from the package index.

The differential suite executes the oracle, reference harness, and extracted reducer on identical synthetic states/actions and compares complete resulting states.

## Verified scenarios

| Area | Differential scenario | Status |
|---|---|---|
| Reply / intent | High intent, fit/handoff, opt-out and sticky opt-out | PASS |
| Reply / intent | Edited identity; original + edited DNC fingerprints | PASS |
| Campaign simulation | All nine script cursor positions and terminal boundary | PASS |
| Campaign simulation | Connection accepted, positive reply, inbox/notification creation, approval event | PASS |
| Campaign simulation | Non-running and fully DNC-suppressed audience guards | PASS |
| Inbox approval | Awaiting item approval, simulated conversation, qualification and notification | PASS |
| Inbox review | Reminder, reject and dismiss state transitions | PASS |
| Inbox DNC | Approval/reminder blocked after opt-out | PASS |
| Draft review | Save, approve, delete and DNC approval/save guards | PASS |
| DNC | Re-import identity guard and append-only reset behavior | PASS |
| Prospect lifecycle | Add/dedupe, edit, imported deletion and seeded-record hiding | PASS |
| Campaign lifecycle | Create/update, status change, restart and delete | PASS |
| Workflow simulation | Start, pause, restart, tick and terminal behavior | PASS |
| Notifications | Queue/history caps and dismissal | PASS |
| State management | ICP/industry, selection, workflow patch and hydrate replacement | PASS |
| Invalid/missing records | Missing prospect/action targets preserve no-op behavior | PASS |
| Deterministic metadata | Identical action metadata produces matching IDs/timestamps | PASS |

## Mismatch found and corrected

The initial differential comparison caught a real `SUBMIT_REPLY` DNC mismatch after prospect identity edits. The harness initially stored only the edited fingerprint; the pinned reducer preserves both original and edited fingerprints. The harness was corrected and the regression is retained.

## Extraction and CI status

The reducer has now been extracted into the isolated core package and exported from `src/index.ts`. The differential test suite compares the extracted reducer against the pinned oracle for every covered case.

Latest verified CI:
- Run: [43313072939](https://github.com/shahid-ai-automation/leadforge-intelligence/actions/runs/43313072939)
- Commit: `3776f2e50cf1d2fa91c0a50dc97e2366f7762175`
- Strict TypeScript check: PASS
- 4 test files: PASS
- 93 tests: PASS, including 48 differential cases
- Extracted reducer compared against oracle: PASS

A subsequent source-comment-only provenance clarification is committed separately and does not change reducer behavior.

## Remaining integration boundaries

This is a **core-package extraction only**, not an application integration:
- The extracted reducer is not wired into Development Remix or Production.
- Application `seedState()` composition and browser/server `applyAction` wrapper remain outside the package.
- The oracle and reducer share pure domain helpers (intent, scoring, simulation script, identity hashing, draft state machine); this suite checks reducer transition wiring and resulting state, not independent correctness of those shared helpers.
- Module-global notification ID continuity across multiple browser actions is normalized to deterministic per-transition metadata in tests.
- Manual E2E completion remains separate; prior E2E status remains partial.

## Safety boundary

Production and Development Remix remain untouched. No deployment, UI change, database change, external integration, real prospect data, or live outbound send is part of this extraction. Do not integrate the new module into either Remix until a separate integration plan and explicit approval.
