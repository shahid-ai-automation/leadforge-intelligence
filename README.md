# LeadForge Intelligence

<p align="center">
  <strong>An anonymized engineering case study in outbound intelligence, deterministic workflows, and human-reviewed campaign operations.</strong>
</p>

<p align="center">
  <a href="https://github.com/shahid-ai-automation/leadforge-intelligence/actions/workflows/leadforge-core.yml"><img src="https://img.shields.io/badge/CI-core%20checks-blue?style=for-the-badge&logo=githubactions&logoColor=white" alt="Core CI" /></a>
  <img src="https://img.shields.io/badge/TypeScript-strict-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="Strict TypeScript" />
  <img src="https://img.shields.io/badge/Tests-105%20passing-16A34A?style=for-the-badge&logo=vitest&logoColor=white" alt="105 tests passing on the latest verified code run" />
  <img src="https://img.shields.io/badge/Outbound-simulation%20only-orange?style=for-the-badge" alt="Simulation only" />
</p>

<table>
  <tr>
    <td bgcolor="#e8f5e9" align="center">
      <strong>🟢 ENGINEERING VERDICT</strong><br/>
      <strong>Isolated LeadForge Core: implemented and verified</strong><br/>
      <sub>Application adapter: implemented and tested in isolation · Remix integration: not started</sub>
    </td>
  </tr>
</table>

## Overview

LeadForge is an AI-assisted outbound intelligence concept designed to help a sales or placement-services team move from an ideal customer profile (ICP) to a reviewed, prioritized, and monitored prospecting campaign.

The product workflow brings together prospect discovery, fit assessment, campaign planning, channel-specific draft preparation, human approval, follow-up sequencing, and engagement-based intent signals.

This repository is an **anonymized engineering artifact**, not a complete export of the original application or a claim that every planned capability is live.

## Product workflow

| Stage | Capability | Purpose |
|---|---|---|
| **01 · Discover** | ICP-based prospect filtering | Identify relevant records from an authorized, supplied workspace dataset |
| **02 · Assess** | Fit scoring and suppression | Prioritize prospects while applying deduplication and Do Not Contact (DNC) rules |
| **03 · Define** | Campaign brief composition | Structure the objective, value proposition, audience, and call to action |
| **04 · Personalize** | Message draft preparation | Prepare channel-specific content with template fallback distinguished from AI output |
| **05 · Review** | Human approval workflow | Keep review and approval as explicit human decisions |
| **06 · Monitor** | Simulated activity and intent signals | Inspect campaign activity and engagement-derived signals without sending live outreach |

## Engineering highlights

- **Deterministic domain logic** for ICP scoring, role matching, intent classification, campaign readiness, and workflow state transitions.
- **Typed application boundary adapter** to translate between the existing application state contract and the isolated core model.
- **Reducer parity verification** against a source-derived oracle using synthetic states and actions.
- **DNC identity fingerprinting** and suppression helpers.
- **Draft lifecycle rules** with explicit review-state transitions.
- **Strict TypeScript** and automated Vitest coverage.
- **Security-conscious boundaries** that keep authentication, authorization, persistence, concurrency checks, and server-side validation outside the pure core.
- **Simulation-only execution boundary**; this repository does not enable live outbound delivery.

## Architecture

The repository separates reusable domain logic from application-owned responsibilities.

```text
Existing application (reference contract)
        |
        | typed state/action boundary
        v
Application adapter
        |
        v
LeadForge Core
  ├── Domain model
  ├── Deterministic intelligence engine
  ├── Prospect discovery helpers
  ├── DNC suppression
  ├── Draft review rules
  └── Pure state reducer
        |
        v
Typed application state result

Application-owned responsibilities remain outside the core:
  authentication · authorization · persistence · validation
  idempotency · revision/concurrency checks · UI · provider adapters
```

The adapter is a translation boundary, **not a security boundary**. The host application must continue to enforce authorization, entity scope, DNC hard guards, draft-version checks, idempotency, revision checks, and atomic persistence.

## Repository structure

```text
.
├── packages/
│   └── leadforge-core/
│       ├── src/
│       │   ├── model.ts
│       │   ├── engine.ts
│       │   ├── discovery.ts
│       │   ├── suppression.ts
│       │   ├── workspace.ts
│       │   ├── drafts.ts
│       │   ├── reducer.ts
│       │   ├── application-adapter.ts
│       │   └── reference/
│       ├── package.json
│       └── README.md
├── .github/workflows/
│   └── leadforge-core.yml
├── APPLICATION_BOUNDARY_AUDIT.md
├── APPLICATION_INTEGRATION_PLAN.md
├── SECURITY.md
└── SOURCE_ISOLATION.md
```

## Verification status

The latest successful code-verification run recorded in the repository is:

- **Workflow run:** [43315551951](https://github.com/shahid-ai-automation/leadforge-intelligence/actions/runs/43315551951)
- **Verified code commit:** `57cb9868c96b376f941dfb12293c31399557bb53`
- **Strict TypeScript:** PASS
- **Test files:** 6 passed
- **Automated tests:** 105 passed

The 105-test result includes reducer tests, application-adapter contract tests, and differential adapter-versus-oracle tests. The audit and integration-plan documentation were updated in later documentation-only commits; the test count above refers specifically to the verified code commit, not a claim that every subsequent commit has a new CI run.

Run the core package checks locally:

```bash
cd packages/leadforge-core
npm install
npm run typecheck
npm test
```

## Integration status and next phase

<table>
  <tr>
    <td bgcolor="#e8f5e9"><strong>Completed</strong></td>
    <td>Core extraction, typed adapter, contract tests, differential tests, and application-boundary audit.</td>
  </tr>
  <tr>
    <td bgcolor="#fff4e5"><strong>Not started</strong></td>
    <td>Wiring the adapter into a Remix application, database integration, and end-to-end sandbox regression.</td>
  </tr>
  <tr>
    <td bgcolor="#e8f0fe"><strong>Planned gate</strong></td>
    <td>When integration begins, use a separate complete Remix copy with a fresh, isolated Supabase project. Keep the existing Development Remix read-only and Production untouched.</td>
  </tr>
</table>

The next product milestone is to complete and validate the MVP against the updated business requirements. Adapter integration is a separate engineering phase and will be evaluated only after the MVP baseline is accepted.

No deployment, publishing, production migration, or activation is authorized by this repository or its integration plan.

See [APPLICATION_BOUNDARY_AUDIT.md](./APPLICATION_BOUNDARY_AUDIT.md) for the detailed findings and [APPLICATION_INTEGRATION_PLAN.md](./APPLICATION_INTEGRATION_PLAN.md) for the gated integration sequence.

## Security, privacy, and source isolation

- Do not commit environment files, API keys, service-role credentials, session secrets, passcodes, cookies, or database exports.
- Do not include client names, client branding, private business information, personal lead data, account identifiers, or proprietary assets.
- Do not copy the complete private application workspace into this repository.
- Do not automate access to restricted social-network content or send outreach without an authorized integration and explicit operational approval.
- Treat demo records and simulated activity as illustrative, not verified live data.

Read [SECURITY.md](./SECURITY.md) and [SOURCE_ISOLATION.md](./SOURCE_ISOLATION.md) before contributing.

## Scope and limitations

This public repository contains the isolated LeadForge core and engineering documentation. It does **not** contain the complete Remix application, production infrastructure, private datasets, live CRM synchronization, LinkedIn personal-feed scraping, or an active outbound delivery system.

The original development implementation uses TypeScript, React, TanStack Start/Router, Supabase (PostgreSQL), Zod, and an AI SDK integration. Those application-level dependencies and runtime wiring are not part of this isolated core package.

## License

No license has been granted at this stage. All rights reserved unless a license is added explicitly.
