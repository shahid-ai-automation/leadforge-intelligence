# LeadForge application boundary and reducer adapter audit

## Audit scope

Read-only inspection of the Development Remix pinned at
`d84685707d15a5f23321d35bdc3f9ddc7a950386`:
- `src/components/outbound-intelligence/state.ts`
- `src/components/outbound-intelligence/store.tsx`
- `src/components/outbound-intelligence/demoData.ts`
- `src/components/outbound-intelligence/model.ts`
- `src/lib/leadforge/leadforge.functions.ts`
- `src/lib/leadforge/persist.server.ts`
- `src/lib/leadforge/mappers.ts`
- `src/lib/leadforge/mutation.ts`
- `src/lib/leadforge/validation.ts`

No source files in Development Remix or Production were modified. No database or live services were accessed.

## Finding: extracted reducer is not a drop-in replacement

The isolated core reducer deliberately has a fixture-free state contract
(`LeadForgeState`) which differs from the application `LFIState`.

| Concern | Development Remix contract | Extracted core contract | Adapter requirement |
|---|---|---|---|
| Seed prospect catalogue | Imported statically from `DEMO_PROSPECTS`; not part of `LFIState` | `state.prospects` | Inject pinned `DEMO_PROSPECTS` into core input |
| Industry ICP catalogue | Imported statically from `DEMO_ICPS`; not part of `LFIState` | `state.industryIcps` | Inject pinned `DEMO_ICPS` |
| Reset action | `{ type: "RESET" }`; reducer calls `seedState()` | `{ type: "RESET", baseline }` | Build baseline using app `seedState()`, then convert it to core state |
| Hydrate action | Payload is app `LFIState` | Payload is `LeadForgeState` | Convert payload to/from core state; preserve replacement semantics |
| Draft concurrency | Actions carry `expectedVersion` | Reducer action union omits concurrency metadata | Keep version validation in server boundary; strip only when calling pure reducer |
| Review concurrency | `REVIEW_DRAFT` carries required `expectedVersion` | Core reducer consumes status/prospect only | Keep authoritative version check outside reducer |
| Stage action | `MOVE_STAGE` may carry `authorized?` | Core reducer consumes prospect/stage | Preserve validation semantics; unused metadata must not bypass guards |
| Industry action | `DemoIndustry` finite union | Core action currently accepts `string` | Narrow/validate before core call |
| Notifications | App has module-global notification ID counter | Core accepts a per-call `notificationStart` | Adapter must maintain compatible counter continuity |
| Static/transient fields | Seeds are code-owned; `notifications`, `selectedProspectId`, `simRunning` are not all persisted | Core state contains injected seeds and transient state | Do not accidentally persist static or transient adapter fields |

## Existing application boundaries that must remain outside core

### Browser store

`store.tsx` owns:
- React `useReducer` and the `envReducer` wrapper;
- optimistic browser state updates;
- UI-only action classification: `SELECT_PROSPECT`, `SIM_START`,
  `SIM_PAUSE`, `DISMISS_NOTIFICATION`, `HYDRATE`;
- action queueing, in-flight deduplication, generation cancellation,
  revision tracking and retry/reload behavior;
- creation of per-action metadata via `newActionMeta()`;
- session gate, lock/unlock and workspace loading.

The extracted reducer must not absorb any of these concerns.

### Server mutation boundary

`persist.server.ts` loads the authoritative snapshot, checks idempotent replay
keys and expected workspace revision, calls `assertActionScope`, applies the
action, maps the resulting state to database rows, and commits the atomic
mutation. It also forces `simRunning: true` for server-side `SIM_TICK`.

`mutation.ts` owns entity scope, DNC hard guards, draft version checks,
approved-content immutability, campaign readiness/status transitions, and
allowed mutation semantics. `validation.ts` owns strict Zod payload validation.
These are security and persistence boundaries and must not be moved into the
pure reducer or weakened by an adapter.

### Persistence mapping

`mappers.ts` maps app `LFIState` to the existing `lf_*` tables and back.
Seed prospect profiles and default runtime are reconstructed from code-owned
demo data; only imported profiles and mutable workspace state are stored.
The app reducer adapter must return an `LFIState`-shaped result so the existing
mapper contract stays unchanged.

## Proposed adapter contract (design only; not implemented)

1. `toCoreState(appState)` creates a `LeadForgeState` by injecting
   `DEMO_PROSPECTS` and `DEMO_ICPS`, then copying all mutable app state fields.
2. `toAppState(coreState)` removes the injected static catalogue fields and
   returns only the existing `LFIState` shape. No core-only fields may leak into
   persistence JSON or database rows.
3. `toCoreAction(action, appState)` forwards ordinary pure state actions after
   boundary validation. For `RESET`, it supplies
   `toCoreState(seedState())`. For `HYDRATE`, it converts the app payload to
   core state. Version/concurrency metadata remains owned by the caller.
4. The adapter supplies a notification counter value compatible with the
   existing module-global `nid` behavior, and returns the updated counter
   only after a successful reducer transition. Counter continuity must be tested
   across multiple actions, not normalized separately per test case.
5. The same adapter must be used consistently by browser and server reducer
   calls so optimistic and authoritative results remain byte-for-byte
   equivalent for the same action metadata.
6. Existing `UI_ONLY`, queue, revision, idempotency, DNC, validation, session,
   and persistence wrappers remain unchanged.

## Required adapter tests before any app integration

- Round-trip app → core → app preserves every mutable `LFIState` field and
  does not persist `prospects` or `industryIcps`.
- Every app action is accepted/mapped; `expectedVersion`, `authorized` and
  other boundary metadata are not silently lost before validation.
- `RESET` matches the actual app `seedState()` output while preserving the
  prior append-only suppression map.
- `HYDRATE` remains an exact replacement and does not merge stale state.
- Notification IDs remain continuous across a multi-action sequence and match
  existing browser/server behavior.
- `SIM_TICK` matches the server's `simRunning: true` precondition.
- UI-only actions remain local; persisted actions still go through the same
  queue, idempotency, revision and server guard path.
- `stateToRows` / `rowsToState` round trips remain unchanged and do not
  include core-only injected catalogue fields.
- Browser optimistic output equals authoritative server output for all action
  classes, including reset, import, draft version conflict and DNC blocks.

## Decision

**Boundary audit: complete. Adapter: designed, not implemented. Application
integration: not started.**

The standalone reducer package and its differential suite remain isolated.
Do not replace the Development Remix reducer or alter its store/server code
until a separate adapter implementation plan is approved. Production and
Development Remix remain untouched.
