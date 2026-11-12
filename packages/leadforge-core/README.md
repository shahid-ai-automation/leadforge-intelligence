# LeadForge Core

An anonymized extraction of reusable LeadForge domain logic. This is a core library, not a complete application.

## Included modules

- `model.ts` — domain types and configuration; no prospect or conversation fixtures.
- `engine.ts` — deterministic ICP scoring, role matching, buyer-intent classification, identity normalization, campaign brief composition, message templating, sequence construction, and readiness logic.
- `discovery.ts` — pure ICP filtering and import outcome helpers. It operates only on records supplied by the caller; it does not collect data or contact providers.
- `suppression.ts` — synchronous SHA-256 identity fingerprints for Do Not Contact matching.
- `drafts.ts` — draft editing and review-state transition rules.
- `index.ts` — public exports.

## Deliberately excluded

Customer names, logos, branding, account details, private business information, prospect/conversation fixtures, sample CSV rows, seed datasets, website routes, voice demos, external account integrations, credentials, environment files, and database exports.

## Dependencies

No runtime package dependencies. TypeScript is used for static checking.

## Check

```bash
npm install
npm run typecheck
```

## Provenance

Extracted from the isolated LeadForge Development Remix source at commit `d84685707d15a5f23321d35bdc3f9ddc7a950386`. The source extraction has been text-audited for customer references and fixture leakage. Typecheck and focused regression tests are not yet verified in this environment.

Persistence, authentication, AI-provider adapters, workspace state, UI, and deployment remain outside this package.