# Security Policy

## Public repository boundaries

This repository is an anonymized engineering case study. Do not add:

- Client or employer names, logos, brand assets, private URLs, internal documents, or confidential workflows.
- Real prospect/customer records, contact details, exports, or identifiable conversation content.
- Environment files, API keys, service-role keys, access tokens, passcodes, session cookies, private keys, or database credentials.
- Production database schemas or data unless specifically reviewed and approved for public release.
- Unreviewed workspace files, build artifacts, local databases, or generated exports.

## Required review before every commit

1. Search changed files for client names, email addresses, phone numbers, URLs, account identifiers, and credential-like strings.
2. Confirm that secrets are represented only by environment-variable names and safe placeholders.
3. Confirm server-only privileged code is not imported into browser bundles.
4. Confirm demo data is fictional or appropriately anonymized.
5. Confirm no live outbound actions, scraping, or third-party integrations are enabled by default.

## Reporting

Do not publish sensitive findings in a public issue. Contact the repository owner privately.
