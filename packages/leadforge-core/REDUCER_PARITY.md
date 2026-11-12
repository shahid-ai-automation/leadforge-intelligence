# Reducer differential parity audit

## Pinned source and oracle

The behavioral source is the read-only Development Remix file
`src/components/outbound-intelligence/state.ts` at commit
`d84685707d15a5f23321d35bdc3f9ddc7a950386`.

`src/reference/pinned-reducer.oracle.ts` contains the reducer switch body copied
from that exact pinned source. It is test-only and does not import application
fixtures, UI, browser state, Supabase, or network modules. The following boundary
adaptations are documented in the oracle header:
- seeded prospects and ICP configurations are injected through synthetic `RefState`;
- `RESET` receives an injected synthetic baseline instead of calling application `seedState()`;
- clock, random ID generation, and module-global notification IDs are deterministic per comparison.

`src/reference/reducer-harness.ts` is the independent fixture-free implementation
under comparison. Differential tests execute both functions against identical
synthetic states and actions, then compare the complete resulting state.

## Differential coverage

The differential suite covers all reducer action branches:
- reply classification, intent/handoff, sticky opt-out and identity suppression;
- campaign simulation, all nine script cursors, terminal boundaries, status and restart;
- inbox approve, reminder, reject, dismiss, and DNC blocking;
- draft save/review/delete and DNC approval guards;
- prospect add/dedupe, edit, delete, hidden sample behavior and imported deletion;
- ICP/industry, selection, workflow updates and workflow simulation;
- notification queue/history caps and dismissal;
- reset with append-only DNC preservation and hydrate replacement;
- missing-record no-op behavior and deterministic IDs/timestamps.

Tests compare deep state equality, not only action names or selected fields.
The oracle and harness share pure domain helpers (intent, scoring, script,
identity hashing, draft transitions); this audit validates reducer transition
wiring and state effects, not independent re-derivation of those domain algorithms.

## Mismatch found and corrected

The first executable differential run exposed a real mismatch in `SUBMIT_REPLY`
after an opt-out: the harness wrote hashes only for the currently edited prospect,
while the pinned reducer's `addSuppressions` stores both the original identity
and the edited identity. The harness was corrected to use the same append-only
suppression helper. A dedicated regression test now protects both fingerprints.

## Validation status

Latest verified GitHub Actions run:
- Commit: `6972aae108077f934fc9018901093178b610a76c`
- Run: [43312223569](https://github.com/shahid-ai-automation/leadforge-intelligence/actions/runs/43312223569)
- Strict TypeScript check: PASS
- Focused tests: 82 PASS across 4 files

The expanded all-cursor and DNC-guard matrix was added after that run and is
awaiting its own CI result. Do not treat this audit as complete until the latest
expanded suite is green.

## Explicit boundaries

- No reducer extraction is authorized by this audit.
- The pinned `state.ts` remains read-only and unchanged.
- Development Remix and Production remain untouched.
- No demo fixture, browser, database, real prospect, external account, or live
  outbound send is used by this differential test package.
