# LeadForge reducer application integration plan

## Current verified position

- Core reducer extracted to `packages/leadforge-core/src/reducer.ts`.
- Typed application boundary adapter exists at `src/application-adapter.ts`.
- Adapter contract tests and source-oracle differential tests pass.
- Latest CI: [43315551951](https://github.com/shahid-ai-automation/leadforge-intelligence/actions/runs/43315551951)
- Commit: `57cb9868c96b376f941dfb12293c31399557bb53`
- Strict TypeScript: PASS; 6 test files; 105 tests.
- Application Boundary Audit: `APPLICATION_BOUNDARY_AUDIT.md`.

## Non-negotiable safety boundary

This plan does not authorize edits to either the Production project or the
existing Development Remix. Do not connect the package to either project,
change a database, deploy, publish, or activate an integration without explicit
approval for that exact step.

The next implementation environment, if approved, must be a separately created
Integration Sandbox copied from the Development Remix, with its own isolated
Supabase project and no production credentials or live provider connections.

## Phase 1 — create an isolated integration sandbox (approval required)

1. Capture the current Development Remix commit and project configuration as a
   read-only baseline.
2. Create a separate sandbox copy; verify its project ID differs from both
   Production and Development Remix.
3. Verify its Supabase project is separate and contains only the expected
   LeadForge demo schema. Never copy secrets or read secret values.
4. Keep outbound provider integrations disabled and all simulation-only
   controls intact.
5. Record a rollback point before any code changes.

Exit criteria: isolated project and database verified; no Production or
Development Remix changes.

## Phase 2 — adapter wiring in sandbox only (approval required)

1. Add the core package dependency through a reviewed local/workspace package
   reference; do not introduce a public package publish step.
2. Add a thin application adapter bridge that injects the sandbox's
   `DEMO_PROSPECTS` and `DEMO_ICPS` and supplies `seedState()` for RESET.
3. Preserve the current React `envReducer`, optimistic dispatch, action queue,
   revision handling, retry/reload, and UI-only action set.
4. Preserve server `assertActionScope`, strict Zod validation, DNC hard guards,
   draft expected-version checks, campaign readiness, idempotency, workspace
   revision checks, and atomic mutation RPC unchanged.
5. Keep the current application reducer available as a reference implementation.
6. Initially run both reducers in shadow mode for synthetic actions only; do
   not use real workspace records to generate outbound effects.
7. Compare complete state results and notification counters. Any mismatch
   blocks activation.

Exit criteria: adapter parity against the app reducer for every action branch,
including multi-action notification counter continuity, reset, hydration, and
server/browser deterministic metadata.

## Phase 3 — sandbox QA (approval required)

- Strict typecheck and complete package/app build.
- Unit and differential tests for all app action branches.
- Mapper round-trip tests (`stateToRows` / `rowsToState`) proving injected
  seed catalogues do not leak into persisted workspace rows.
- Server mutation tests for expected revision, idempotent replay, stale draft
  version, DNC and entity-scope rejection.
- Browser optimistic result equals server authoritative result for every
  supported action class.
- Manual UI regression: campaign wizard, campaign monitoring, prospect list,
  inbox, drafts, settings and reset.
- Confirm no UI/UX changes and no real send/provider call occurs.

Exit criteria: all automated tests green, manual regression signed off, and
explicit approval to replace the sandbox reference reducer.

## Phase 4 — activation decision

1. Keep activation confined to the Integration Sandbox.
2. Preserve a one-commit rollback to the original sandbox reducer.
3. Do not deploy or publish.
4. Production remains untouched. Any future Production work requires a new,
   separate approval and a reviewed migration/rollback plan.

## Current decision

**Plan documented. No sandbox has been created and no Remix project has been
modified.** The isolated core package and adapter remain a separately tested
engineering artifact.
