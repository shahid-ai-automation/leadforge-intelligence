# Source Isolation Record

## Extraction boundary

The public repository contains a separately isolated, anonymized LeadForge core package. Source was read from the Development Remix at commit `d84685707d15a5f23321d35bdc3f9ddc7a950386`; the Development Remix itself was not modified.

## Included

- `packages/leadforge-core/src/model.ts` — reusable domain types and configuration.
- `packages/leadforge-core/src/engine.ts` — deterministic scoring, identity, intent, campaign, messaging, and sequence logic.
- `packages/leadforge-core/src/discovery.ts` — pure ICP filtering, size filters, and import outcome helpers; no live data collection.
- `packages/leadforge-core/src/suppression.ts` — DNC identity hashing.
- `packages/leadforge-core/src/workspace.ts` — pure prospect collection, deduplication, edit overlay, and suppression helpers with caller-injected seed catalogs.
- `packages/leadforge-core/src/drafts.ts` — draft edit/review transition rules, with workspace-bound conversation history excluded.
- `packages/leadforge-core/src/index.ts` — public package exports.

## Sanitization and exclusions

- Removed customer-identifying comments and customer-specific email signature text.
- Removed prospect and conversation seed fixtures and sample CSV rows.
- Excluded all customer names, logos, branding, accounts, credentials, secrets, `.env` files, private business data, live prospect records, seed datasets, website code, voice-demo code, and database exports.
- Excluded the demo-seeded application reducer and seed-state factory because they remain coupled to demo fixtures. Extracted only fixture-independent workspace collection/suppression primitives with injected seed catalogs. Server persistence, session gate, AI provider adapter, and UI remain outside the package because they are coupled to Supabase/TanStack runtime or workspace configuration.

## Validation

Uploaded source files were fetched back from the public repository and text-audited for customer references, fixture identifiers, secrets, and platform credentials. This is not a build verification. TypeScript typecheck and focused regression tests remain pending; the repository is not yet represented as a complete runnable application.
