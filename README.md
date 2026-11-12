# LeadForge Intelligence

An anonymized engineering case study of an AI-assisted outbound intelligence platform.

LeadForge helps a sales or placement-services team move from a defined ideal customer profile (ICP) to a reviewed, prioritized, and monitored prospecting campaign. The product combines workspace-level prospect discovery, campaign strategy generation, channel-specific message drafting, human approval, follow-up planning, and engagement-based intent signals.

> **Demo status:** The demonstrated workflow uses illustrative workspace records and simulated campaign activity. It does not represent verified live leads, real LinkedIn activity, or messages sent to external recipients.

## Product workflow

1. **Discover** — search the existing demo workspace for prospects matching ICP criteria; apply fit scoring, deduplication, and Do Not Contact (DNC) suppression.
2. **Define** — generate a structured campaign brief from the campaign objective, value proposition, audience, and call to action.
3. **Personalize** — prepare prospect-specific drafts for supported outreach channels, with template fallback clearly distinguished from AI-generated content.
4. **Review** — inspect drafts individually or in bulk; approval remains an explicit human action.
5. **Plan** — configure a multi-step follow-up sequence.
6. **Monitor** — inspect simulated campaign activity, replies, and engagement-derived intent signals.

## Engineering highlights

- Server-mediated persistence with a shared demo workspace.
- Passcode-protected demo access and revocable server-validated sessions.
- Server-only privileged database access; privileged credentials are not shipped to the browser.
- Schema validation and bounded request payloads.
- Workspace scoping, optimistic revision checks, idempotency/replay protection, and atomic mutation handling.
- Append-only mutation audit records and database-derived metrics.
- DNC suppression across matching identities and campaign approval safeguards.
- Human-in-the-loop review; generated content is not automatically approved.
- Simulated execution boundary: no live outbound delivery is enabled in the demonstrated environment.

## Architecture (high level)

```text
Browser UI
   |
   v
TanStack Start server functions
   |
   v
Demo session verification
   |
   v
Validated domain actions
   |
   v
Server-only database client
   |
   +--> Workspace snapshot / revision
   +--> Atomic mutations / audit
   +--> Metrics
   |
   v
UI refreshes from persisted workspace state

AI brief and message generation:
Server function -> AI provider gateway -> schema-validated output -> UI review
```

## Technology

The development implementation uses TypeScript, React, TanStack Start/Router, Supabase (PostgreSQL), Zod, and an AI SDK integration. The original workspace also contains unrelated website and voice-demo functionality; this repository is intended to contain only reviewed, LeadForge-specific material rather than a wholesale copy of that workspace.

## Security and privacy

- Never commit environment files, API keys, service-role credentials, session secrets, passcodes, cookies, or database exports.
- Keep privileged database clients in server-only modules.
- Treat all demo records as illustrative unless independently verified.
- Do not include client names, client branding, private business information, personal lead data, or account identifiers.
- Do not automate access to restricted social-network content or send outreach without an authorized integration and explicit operational approval.

See SECURITY.md for the repository handling rules.

## Scope and limitations

This repository documents an anonymized engineering implementation. The public case study does not include production credentials, client-specific integrations, private datasets, or an export of the complete development workspace.

The demonstrated campaign execution is simulation-only. LinkedIn personal-feed monitoring, live prospect sourcing, CRM synchronization, and real outbound delivery are not claimed as implemented capabilities.

## Local development

A complete, independently runnable public application package is not yet provided. Setup instructions will be added only after the LeadForge source has been separated from workspace-level dependencies and reviewed for secrets, client references, and licensing constraints.

## Quality approach

The development work includes unit and integration-oriented tests for campaign state, prospect discovery, DNC suppression, message review, persistence, and server-side validation. Test counts and pass status should be associated with a specific commit or release rather than treated as permanent guarantees.

## License

No license has been granted at this stage. All rights reserved unless a license is added explicitly.


## Source package

The repository includes an isolated `packages/leadforge-core` source package with anonymized domain types, deterministic intelligence logic, pure ICP discovery helpers, DNC identity hashing, and draft-review rules. The full application (UI, authentication, persistence, provider adapters, and deployment wiring) is not yet extracted; this repository does not claim to be a complete runnable product.
