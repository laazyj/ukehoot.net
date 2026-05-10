# `@ukehoot-net/cdk`

AWS CDK app that owns the domain, DNS, certificate, CDN, S3 bucket, and
alarms for [ukehoot.net](https://ukehoot.net).

Built with [composureCDK](https://github.com/laazyj/composureCDK): the
five stacks are wired declaratively as one composed system in
[`src/system.ts`](./src/system.ts) and deploy together with
`cdk deploy --all`. The docblock on `createSystem()` walks through the
three moving parts (the builder block, the dependency block, and the
`withStacks` / `afterBuild` wiring).

## File map

| File                                                     | Role                                                                                                                                                            |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`src/app.ts`](./src/app.ts)                             | Entry point. Builds the `App` and the five stacks. The top-of-file `CONFIG` block holds the domain and region settings.                                         |
| [`src/system.ts`](./src/system.ts)                       | The composition root — the `compose(...)` call that wires every builder.                                                                                        |
| [`src/redirect-function.ts`](./src/redirect-function.ts) | The CloudFront viewer-request function source: `www`→apex, old-URL 301s, directory→index rewrite. Only the string between the backticks ships to the edge.      |
| [`src/redirects.ts`](./src/redirects.ts)                 | Synth-time loader and validator for `redirects.json`. Not deployed to CloudFront.                                                                               |
| [`src/zone-records.ts`](./src/zone-records.ts)           | DNS records for the zone (mail, DKIM, verification tokens). Apex and `www` ALIASes are added in `system.ts` because they depend on the CloudFront distribution. |
| [`redirects.json`](./redirects.json)                     | Map of legacy Tumblr URL paths → new paths. Compiled into the CloudFront Function at synth time after validation by `src/redirects.ts`.                         |
| [`scripts/`](./scripts/)                                 | Post-deploy operational scripts. Currently: redirect verification.                                                                                              |
| [`test/`](./test/)                                       | Vitest snapshot tests + functional assertions. Snapshots are committed and reviewed in PRs.                                                                     |

## Stack architecture

```
Cross-region edges (auto-wired by `crossRegionReferences: true`):

  DnsStack    (eu-west-2) ── DNS validation ──▶ CertStack       (us-east-1)
  CertStack   (us-east-1) ── certificate ARN ─▶ SiteStack       (eu-west-2)
  SiteStack   (eu-west-2) ── distribution id ─▶ CdnAlarmsStack  (us-east-1)

Same-region edges (us-east-1):

  UsEast1AlertsStack ── alarm actions ──▶ CertStack, CdnAlarmsStack
```

The CDK app is a single top-level `compose()` routed across five CloudFormation stacks:

- **`UkehootNetDnsStack`** (`eu-west-2`) — Route 53 hosted zone + all non-apex DNS
  records (mail A records, DKIM CNAMEs, MX, SPF/DMARC TXT). Route 53 is a global
  service; the region choice is cosmetic.
- **`UkehootNetCertStack`** (`us-east-1`) — ACM certificate for apex + `www`,
  DNS-validated against the hosted zone. `us-east-1` is an AWS requirement for
  certificates attached to CloudFront.
- **`UkehootNetSiteStack`** (`eu-west-2`) — S3 bucket, CloudFront distribution,
  CloudFront Function (`www`→apex + old-URL 301s + directory→index), bucket
  deployment of the Eleventy output, apex/`www` alias records, Route 53 health
  check, and an SNS topic for site-region alarms.
- **`UkehootNetUsEast1AlertsStack`** (`us-east-1`) — SNS topic shared by every
  us-east-1 alarm (cert, CloudFront, health-check) plus the monthly Budget. No
  downstream deps so any us-east-1 stack can target it without creating a cycle.
- **`UkehootNetCdnAlarmsStack`** (`us-east-1`) — CloudFront and Route 53
  health-check CloudWatch alarms. Both metric streams emit only in `us-east-1`,
  so the alarms must live there too. Kept separate from the cert stack to avoid
  a `cdn ↔ cert` cycle.

Every stack opts in to `crossRegionReferences: true`, which lets CDK
auto-generate the SSM-parameter + custom-resource plumbing for cross-region
edges. Deployment order is inferred from the references, so no `addDependency`
calls are needed.

## Tests

```sh
npx nx run @ukehoot-net/cdk:test
```

Two test files:

- [`test/app.test.ts`](./test/app.test.ts) — synthesises every stack, snapshots
  the CloudFormation, and adds functional assertions for invariants that must
  hold regardless of refactors (certificate SANs, budget limit, alarm coverage).
- [`test/redirects.test.ts`](./test/redirects.test.ts) — validates the shape of
  [`redirects.json`](./redirects.json) at build time, so bad data fails the test
  rather than reaching the deployed CloudFront Function (which has a
  sub-millisecond CPU budget per request).

After intentional infra changes, regenerate snapshots with
`npx nx run @ukehoot-net/cdk:test -- -u`.

## Linting and formatting

Inherits the root ESLint and Prettier configs. Run `npm run lint` /
`npm run format:check` from the repo root.

## See also

- [Top-level README](../../README.md) — repo overview.
- [composureCDK](https://github.com/laazyj/composureCDK) — the framework used here.
