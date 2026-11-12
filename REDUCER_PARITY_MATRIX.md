# Reducer parity matrix — pre-extraction gate

This matrix records required behavior from the original reducer. Reducer-only behavior is not marked verified until a fixture-free reference harness can execute it.

| Area | Scenario | Expected invariant | Status |
|---|---|---|---|
| Reply / intent | Opt-out alongside buying signals | Opt-out wins; score 0; DNC fingerprints persist | Core intent tested; reducer transition pending |
| Reply / intent | High intent + fit >= 65 | Intent stored; qualified stage; notification/activity | Core scoring tested; reducer transition pending |
| Reply / intent | High intent + fit < 65 | No handoff; fit-gate notification | Pending reducer harness |
| Reply / intent | Reply after prior opt-out | Opt-out cannot be cleared or reactivated | Pending reducer harness |
| Campaign simulation | Each script cursor step | Stable event order; cursor increments; simulated only | Script tested; reducer transition pending |
| Campaign simulation | Accept / positive reply | Runtime, conversation, inbox, counters and notifications update | Pending reducer harness |
| Campaign simulation | Opted-out campaign member | No simulated outreach, reply or follow-up | DNC helper tested; reducer transition pending |
| Inbox approval | Awaiting or reminder item approved | Simulated reply appended; approved status; notification/activity | Pending reducer harness |
| Inbox approval | Rejected/dismissed/already approved item | Approval is a no-op | Pending reducer harness |
| Inbox approval | Opted-out prospect | No reply append or simulated send | DNC helper tested; reducer transition pending |
| Inbox review | Reject awaiting item | Rejected status; explicit nothing-sent activity | Pending reducer harness |
| Inbox reminder | Awaiting/reminder item | Reminder status + days; DNC blocks reminder | Pending reducer harness |
| Reset | Reset after opt-out | Demo resets but historical DNC hashes remain | Pending reducer harness |
| Reset | Reset after custom import | Imported records clear; seed state restored | Pending reducer harness |
| Deterministic metadata | Same action + same seed/time | Event/activity/inbox IDs and timestamps match | Pending reducer harness |
| Deterministic metadata | Different action seeds | Generated IDs do not collide | Pending reducer harness |
| Deterministic metadata | Nested/sequential apply; thrown error | Action context restored in all cases | Pending reducer harness |

## Extraction gate

Do not extract the reducer until a fixture-free reference harness can execute the original transition behavior, every pending scenario above has an executable regression test, deterministic metadata is repeatable, DNC guards pass across reply/campaign/inbox/reset, and CI typecheck plus focused tests pass.

Original source was inspected read-only at pinned Development Remix commit d84685707d15a5f23321d35bdc3f9ddc7a950386. No Production or Development Remix writes are permitted for this work.
