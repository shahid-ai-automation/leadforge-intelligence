# Reducer differential parity matrix — pre-extraction gate

Pinned source: Development Remix `src/components/outbound-intelligence/state.ts` at
`d84685707d15a5f23321d35bdc3f9ddc7a950386`.

The test-only `packages/leadforge-core/src/reference/pinned-reducer.oracle.ts`
contains the source reducer switch body with documented fixture and deterministic
metadata injection. It is compared against the fixture-free
`reducer-harness.ts` using identical synthetic state/action inputs and deep
state equality. No application fixtures, live contacts, browser, database, or
external providers are involved.

| Area | Differential scenario | Status |
|---|---|---|
| Reply / intent | High intent, fit/handoff, opt-out and sticky opt-out | PASS |
| Reply / intent | Reply after identity edit; original + edited DNC fingerprints | PASS — regression added after mismatch |
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
| Deterministic metadata | Identical action metadata produces matching IDs/timestamps in each transition | PASS |

## Mismatch found and fixed

The first executable comparison found a real `SUBMIT_REPLY` DNC mismatch after a
prospect identity edit. The harness stored the edited fingerprint only, whereas
the pinned reducer's `addSuppressions` stores both the original and edited
identity fingerprints. The harness now uses the same suppression helper and a
dedicated differential regression test verifies the behavior.

## CI evidence

Latest successful run: [43312395639](https://github.com/shahid-ai-automation/leadforge-intelligence/actions/runs/43312395639)

- Commit: `fe5ad7fc6cccde75e356c2047ade17b78809e2b5`
- Strict TypeScript check: PASS
- 4 test files: PASS
- 93 tests: PASS, including 48 differential cases

## Remaining limits before extraction

- Oracle adaptations inject synthetic seed prospects/ICPs and a reset baseline;
  actual `seedState()` composition and app-boundary hydration remain outside
  this fixture-free test.
- The oracle and harness intentionally share pure domain helpers (intent,
  scoring, simulation script, identity hashing, and draft state machine). This
  differential suite checks reducer transition wiring/state effects, not
  independent correctness of those shared helper algorithms.
- Module-global notification ID behavior is normalized through a deterministic
  per-transition starting counter. Multi-action global counter continuity and
  the browser/server `applyAction` context wrapper are not independently
  exercised by this suite.
- Manual E2E completion remains separate from reducer parity; this audit does
  not change the previously recorded partial E2E status.

## Extraction gate and safety boundary

The reducer has **not** been extracted. Do not extract it based solely on this
green differential suite; wait for explicit approval and preserve controlled
module-by-module parity tests during any future extraction.

Pinned `state.ts` remains read-only. Production and Development Remix remain
untouched. No deployment, UI change, database change, external integration, or
real outbound send is part of this work.
