# Security Policy

If you find a security issue in this repository or in the live site
([ukehoot.net](https://ukehoot.net/)), please report it privately rather
than opening a public issue.

## Reporting a vulnerability

Use GitHub's **Private Vulnerability Reporting** flow:

[**Report a vulnerability →**](https://github.com/laazyj/ukehoot.net/security/advisories/new)

(Or: navigate to the **Security** tab on the repository, then choose
_Report a vulnerability_.)

This routes the report directly to me through GitHub, with no public visibility
until we coordinate disclosure. I'll acknowledge receipt within a few days
and keep you posted on progress.

## Scope

In scope:

- The CDK infrastructure under `packages/cdk/` (IAM, S3, CloudFront, Route 53
  configuration that ends up deployed to AWS).
- The Eleventy site build under `packages/site/`.
- The CloudFront viewer-request function in
  `packages/cdk/src/redirect-function.ts` (runs on every request to the live
  site).
- The GitHub Actions workflows in `.github/workflows/`.

Out of scope:

- Vulnerabilities in upstream dependencies — please report those upstream;
  Dependabot picks them up here automatically.
- Findings against forks or third-party copies of this code.
- Reports that require physical access, social engineering, or compromise of
  the repository owner's accounts.

Thanks for taking the time to report responsibly.
