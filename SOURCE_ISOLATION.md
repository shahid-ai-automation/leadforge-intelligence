# Source Isolation Record

## Extraction boundary

The public repository contains a separately isolated, anonymized LeadForge core package. The source was read from the Development Remix at commit `d84685707d15a5f23321d35bdc3f9ddc7a950386`; the Development Remix itself was not modified.

## Included in this extraction

- `packages/leadforge-core/src/model.ts`: reusable domain types and configuration.
- `packages/leadforge-core/src/engine.ts`: deterministic scoring, identity, intent, campaign, messaging, and sequence logic.

## Sanitization performed

- Removed the original customer-identifying header from the domain model.
- Removed prospect and conversation seed fixtures from the domain model.
- Removed the sample CSV rows from the engine.
- Replaced customer-specific email signature text with a neutral generic signature.
- Checked the extracted files for customer name/brand markers and fixture declarations before upload.

## Excluded

No customer name, branding, logo, client account, credentials, secrets, `.env` files, private business data, live prospect records, seed datasets, website code, voice-demo code, or database exports are included.

## Not yet extracted

The state/reducer, discovery adapter, persistence layer, session gate, AI provider adapter, and UI remain coupled to the original app's demo fixtures, Supabase/TanStack runtime, or workspace configuration. They are not copied until they can be separated and independently reviewed. This is intentional; the package is not represented as a complete runnable application.

## Validation status

Text-level anonymization checks passed before upload. A clean install, TypeScript typecheck, and focused regression tests are still required before calling the package build-verified.
