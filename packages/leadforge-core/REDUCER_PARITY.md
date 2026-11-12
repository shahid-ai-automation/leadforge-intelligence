# Reducer parity reference harness

## Oracle and boundary

The reference behavior is transcribed from the read-only Development Remix source
`src/components/outbound-intelligence/state.ts` at pinned commit
`d84685707d15a5f23321d35bdc3f9ddc7a950386`.

The harness is deliberately isolated from `demoData`, browser state, Supabase,
network access, real contacts, and the application store. Tests construct synthetic
prospects, campaigns, inbox items, and deterministic action metadata.

This is a behavior-reference harness, not an extracted production reducer. It does
not import the original application reducer at runtime; parity is assessed against
the pinned source contract recorded here. Therefore a passing suite is evidence
for the covered transitions, not proof of whole-application equivalence.

## Covered transition contracts

| Area | Pinned behavior under test |
| --- | --- |
| Reply / intent | Analyze incoming reply, append prospect message, update runtime intent and reply status |
| DNC | Opt-out is sticky; store identity hashes; subsequent positive reply cannot clear opt-out |
| Campaign simulation | Running campaign advances deterministic script; connection acceptance updates stage; reply creates inbox item, conversation and notification |
| Campaign guards | Non-running campaigns and fully opted-out audiences do not advance |
| Inbox approval | Awaiting/reminder item may be approved; record simulated reply and notification; high intent qualifies |
| Inbox review | Reminder, reject and dismiss transitions preserve their distinct statuses |
| Inbox DNC guard | Approval and reminders are blocked for opted-out prospects |
| Reset | Replace session state while preserving accumulated DNC suppression fingerprints |
| Draft review | Draft approval increments version; approved content is read-only; opt-out blocks approval |
| Deterministic metadata | Identical action metadata yields stable activity/event IDs and timestamps |

## Deliberately not yet covered

Before production reducer extraction, extend the matrix to cover all campaign script
cursor positions and terminal boundaries, duplicate/hidden prospect handling,
manual stage changes, every notification cap/history interaction, reset after
multiple opt-outs and edits, malformed/missing record behavior, and the complete
action union (including HYDRATE, campaign status/restart, draft delete, and workflow
simulation controls).

## Extraction gate

Do not extract `state.ts` until:
1. the missing transition matrix above is implemented with fixture-free inputs;
2. reference expectations are reviewed against the pinned source;
3. strict TypeScript and all regression tests pass in CI;
4. each future extracted module is introduced behind parity tests, with no UI,
   persistence, production, or external-send changes in this workstream.
