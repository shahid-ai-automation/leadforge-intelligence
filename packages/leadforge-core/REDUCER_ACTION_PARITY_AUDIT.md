# Reducer action parity audit

Pinned oracle: Development Remix `src/components/outbound-intelligence/state.ts` at
`d84685707d15a5f23321d35bdc3f9ddc7a950386`.

The fixture-free reference harness now contains a corresponding branch for every
action discriminant in the pinned reducer:

`HYDRATE`, `RESET`, `SET_ICP`, `SET_DEMO_INDUSTRY`, `SELECT_PROSPECT`,
`SUBMIT_REPLY`, `MOVE_STAGE`, `UPDATE_STEP`, `SIM_START`, `SIM_PAUSE`,
`SIM_RESTART`, `SIM_TICK`, `SAVE_DRAFT`, `REVIEW_DRAFT`, `DELETE_DRAFT`,
`NOTIFY`, `DISMISS_NOTIFICATION`, `ADD_PROSPECTS`, `SAVE_CAMPAIGN`,
`DELETE_CAMPAIGN`, `CAMPAIGN_RESTART`, `CAMPAIGN_SET_STATUS`,
`CAMPAIGN_SIM_NEXT`, `INBOX_APPROVE`, `INBOX_REMINDER`, `INBOX_DISMISS`,
`INBOX_REJECT`, `UPDATE_PROSPECT`, and `DELETE_PROSPECT`.

The comparison shares pure domain helpers from the isolated package (intent, fit,
priority, campaign script, identity normalization, suppression hashes, draft
editing/review). It injects synthetic records and deterministic action metadata.
No demo fixture module, app store, database, browser, or external provider is loaded.

## Explicit limitations before extraction

- The harness models reset by injecting a synthetic baseline; it does not execute
  the pinned `seedState()` or load `demoData`. Seed-state composition therefore
  remains an app-boundary contract, not independently exercised here.
- The pinned reducer is inspected at the exact commit above but is not imported into
  the package at runtime. This is a source-reviewed behavioral reference, not a
  differential execution test against the original application module.
- The parity tests cover representative and guarded branches, not every possible
  payload permutation. Campaign cursor terminal, DNC, inbox status guards,
  notification caps, and draft review are covered; further malformed/edge payload
  review remains a pre-extraction task.

No `state.ts` reducer extraction is authorized by this audit alone. Extraction
remains blocked until CI passes on the latest commit and the remaining edge-case
review is complete.
