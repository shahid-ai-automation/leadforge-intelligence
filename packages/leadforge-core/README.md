# LeadForge Core

An anonymized extraction of the reusable domain model and deterministic intelligence engine.

## Included

- Domain types for prospects, ICP configuration, campaigns, messaging, sequences, inbox state, and workflow definitions.
- Deterministic ICP fit scoring, role matching, buyer-intent classification, identity normalization, CSV row validation/mapping, campaign brief composition, message templating, sequence construction, readiness checks, and simulation helpers.

## Deliberately excluded

- Customer names, logos, branding, contact details, accounts, private business information, and customer-specific copy.
- Prospect/conversation fixtures, sample CSV rows, seed datasets, and production records.
- Website routes, shared site components, voice demos, client assets, external account integrations, credentials, environment files, and database exports.

## Dependencies

The core source has no runtime package dependencies. TypeScript is used only for static checking.

## Check

```bash
npm install
npm run typecheck
```

## Provenance

Extracted from the isolated LeadForge Development Remix source at commit `d84685707d15a5f23321d35bdc3f9ddc7a950386`. This package is a source-code extraction, not yet a standalone full application. Persistence, authentication, AI-provider adapters, UI, and deployment are intentionally outside this package.
