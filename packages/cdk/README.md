# `@ukehoot-net/cdk`

AWS CDK app that owns the domain, DNS, certificate, CDN, S3 bucket, alarms,
and CI deploy role for [ukehoot.net](https://ukehoot.net/).

Built with [composureCDK](https://github.com/laazyj/composureCDK): the five
application stacks are wired declaratively as one composed system in
[`src/system.ts`](./src/system.ts) and deploy together with
`cdk deploy --all`. The docblock on `createSystem()` walks through the three
moving parts (the builder block, the dependency block, and the
`withStacks` / `afterBuild` wiring).

## File map

| File                                                           | Role                                                                                                                                                              |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`src/app.ts`](./src/app.ts)                                   | Entry point. Builds the `App`, the five application stacks, and the standalone CI OIDC stack. `CONFIG` holds domain and region; installs the ASCII text policy.   |
| [`src/system.ts`](./src/system.ts)                             | The composition root — the `compose(...)` call that wires every builder.                                                                                          |
| [`src/stacks/ci-oidc-stack.ts`](./src/stacks/ci-oidc-stack.ts) | Standalone OIDC provider + `GitHubActionsDeployRole` assumed by `.github/workflows/`.                                                                             |
| [`src/redirect-function.ts`](./src/redirect-function.ts)       | The CloudFront viewer-request function source: `www`→apex + KVS-backed Tumblr-URL 301s. Only the string between the backticks ships to the edge.                  |
| [`src/redirects.ts`](./src/redirects.ts)                       | Synth-time loader and validator for `redirects.json`. Not deployed to CloudFront.                                                                                 |
| [`src/zone-records.ts`](./src/zone-records.ts)                 | DNS records for the zone (Livemail mail/DKIM, MX, SPF/DMARC). Apex and `www` ALIASes are added in `system.ts` because they depend on the CloudFront distribution. |
| [`redirects.json`](./redirects.json)                           | Map of legacy Tumblr URL paths → new paths. Compiled into a CloudFront KeyValueStore at synth time after validation by `src/redirects.ts`.                        |
| [`scripts/`](./scripts/)                                       | Post-deploy operational scripts: smoke test, redirect verification, IndexNow ping.                                                                                |
| [`test/`](./test/)                                             | Vitest snapshot tests + functional assertions. Snapshots are committed and reviewed in PRs.                                                                       |

## Stack architecture

```
Cross-region edges (auto-wired by `crossRegionReferences: true`):

  DnsStack    (eu-west-2) ── DNS validation ──▶ CertStack       (us-east-1)
  CertStack   (us-east-1) ── certificate ARN ─▶ SiteStack       (eu-west-2)
  SiteStack   (eu-west-2) ── distribution id ─▶ CdnAlarmsStack  (us-east-1)

Same-region edges (us-east-1):

  UsEast1AlertsStack ── alarm actions ──▶ CertStack, CdnAlarmsStack

Standalone (no edges to the application stacks):

  CiOidcStack
```

The CDK app is a single top-level `compose()` routed across five application
stacks plus a standalone CI stack:

- **`UkehootNetDnsStack`** (`eu-west-2`) — Route 53 hosted zone + all non-apex
  DNS records (mail A records, Livemail DKIM CNAMEs, MX, SPF/DMARC TXT). Route
  53 is a global service; the region choice is cosmetic.
- **`UkehootNetCertStack`** (`us-east-1`) — ACM certificate for apex + `www`,
  DNS-validated against the hosted zone. `us-east-1` is an AWS requirement for
  certificates attached to CloudFront.
- **`UkehootNetSiteStack`** (`eu-west-2`) — S3 bucket, CloudFront distribution,
  CloudFront Function (`www`→apex + Tumblr-URL 301s via a KeyValueStore),
  bucket deployment of the Eleventy output, apex/`www` alias records, Route 53
  health check, and an SNS topic for site-region alarms.
- **`UkehootNetUsEast1AlertsStack`** (`us-east-1`) — SNS topic shared by every
  us-east-1 alarm (cert, CloudFront, health check) plus the monthly Budget. No
  downstream deps so any us-east-1 stack can target it without creating a cycle.
- **`UkehootNetCdnAlarmsStack`** (`us-east-1`) — CloudFront and Route 53
  health-check CloudWatch alarms. Both metric streams emit only in `us-east-1`,
  so the alarms must live there too. Kept separate from the cert stack to avoid
  a `cdn ↔ cert` cycle.
- **`UkehootNetCiOidcStack`** (`eu-west-2`) — GitHub OIDC provider and the
  `GitHubActionsDeployRole`. Standalone; deployed once from a workstation.

Every stack opts in to `crossRegionReferences: true`, which lets CDK
auto-generate the SSM-parameter + custom-resource plumbing for cross-region
edges. Deployment order is inferred from the references, so no `addDependency`
calls are needed.

## CDK scripts

Run from the repo root (each `cdk:*` script runs the cdk build + site build
first via Nx's task graph):

- `npm run cdk:synth` — render CloudFormation for all stacks.
- `npm run cdk:diff` — preview changes for all stacks.
- `npm run cdk:deploy` — deploy **all** stacks. Default for simplicity; review
  the per-stack snapshot diffs under `test/__snapshots__/` first.
- `npm run cdk:deploy:stack -- <StackName>` — escape hatch for a single stack
  (e.g. `npm run cdk:deploy:stack -- UkehootNetSiteStack`).

## Post-deploy / one-off scripts

```sh
npm run site:smoke              # post-deploy smoke (homepage, feed, sitemap, sample, 404, www→apex)
npm run site:check-redirects    # validate live 301s match redirects.json
npm run indexnow:ping           # notify search engines of fresh content
```

CI runs all three after every deploy. They're exposed as root scripts for
ad-hoc runs.

Environment variables (each script reads its own subset; missing values fall
back to sensible defaults except where noted):

| Variable            | Used by                          | Default               | Purpose                                                                                       |
| ------------------- | -------------------------------- | --------------------- | --------------------------------------------------------------------------------------------- |
| `BASE_URL`          | smoke, check-redirects, indexnow | `https://ukehoot.net` | Origin under test.                                                                            |
| `EXPECTED_SHA`      | smoke                            | _unset_               | If set, smoke asserts `<meta name="build-sha">` matches; CI sets this to `${{ github.sha }}`. |
| `SMOKE_RETRIES`     | smoke                            | `6`                   | Per-URL retry count for transient failures.                                                   |
| `SMOKE_RETRY_MS`    | smoke                            | `5000`                | Delay between retries in milliseconds.                                                        |
| `SMOKE_SAMPLE`      | smoke                            | `10`                  | Number of randomly-sampled sitemap URLs to probe (`0` disables).                              |
| `SMOKE_CONCURRENCY` | smoke                            | `5`                   | Parallel HTTP fetches for the sample.                                                         |
| `CHECK_TARGET`      | check-redirects                  | _unset_               | When `1`, also follows the redirect target and asserts it returns `200`.                      |
| `CONCURRENCY`       | check-redirects                  | `10`                  | Parallel HTTP fetches.                                                                        |
| `INDEXNOW_KEY`      | indexnow                         | **required**          | Domain-ownership key matching `packages/site/static/<key>.txt`.                               |

`redirects.json` is committed and derived from each post's `originalUrl`
frontmatter; the Tumblr importer in `packages/site/scripts/import-tumblr.mjs`
populated it during migration. Run `site:check-redirects` after a deploy
(or against any `BASE_URL`) to confirm CloudFront returns the expected 301s.

## Deploying

Pushes to `main` deploy automatically — see
[Continuous deployment](#continuous-deployment) below. The manual flow here is
the fallback for emergencies or first-time bootstrap.

The CDK app uses the standard `CDK_DEFAULT_ACCOUNT` / `CDK_DEFAULT_REGION`
environment variables, plus `ALERT_EMAIL` (the address subscribed to both
alarm topics — synth fails if it is unset). Authenticate with the target AWS
account first (e.g. `aws sso login --profile ukehoot.net`, then
`export AWS_PROFILE=ukehoot.net` for the rest of the shell), then:

```sh
export ALERT_EMAIL=alert@jasonduffett.org
export GA_MEASUREMENT_ID=G-XXXXXXXXXX
npm run site:build   # build site content
npm run cdk:synth    # render CloudFormation
npm run cdk:diff     # preview changes
npm run cdk:deploy   # apply (all stacks)
```

After the first deploy, AWS sends one confirmation email per topic
(us-east-1 and eu-west-2). Click both confirm links — alerts only flow once
the subscriptions are in the `Confirmed` state.

### Reviewing infra changes

[`test/app.test.ts`](./test/app.test.ts) snapshots the synthesised
CloudFormation for every stack. Any change that affects the templates
(DNS records, alarm thresholds, distribution config) shows up in the snapshot
diff in the PR. If you intend the change, regenerate with
`npm run test:update`. If you don't, you have a regression.

### Template text is ASCII only

CloudFormation stores template text as ASCII and transliterates anything else
to `?` at deploy time, silently. The deployed template then stops matching the
synthesised one, so `cdk diff` reports a change on every run and each deploy
rewrites the same fields, on a stack nobody touched.

`buildApp()` installs composureCDK's `templateTextPolicy` to catch that at
synth. Put an em-dash or a curly quote in a stack description, an alarm
description, a CloudFront function comment (and so on) and `npm test` fails,
naming the construct and the field. Rewrite the text in ASCII rather than
suppressing it.

The policy has two blind spots. It reads top-level L1 properties, so nested
paths such as `FunctionConfig.Comment` and `DistributionConfig.Comment` are
outside it. And it only checks resource types it knows about: the package ships
a seed registry, which `app.ts` extends via `fields` for the CloudFront
resources this app uses.

Most free-text in this app sits in those blind spots, so
[`test/app.test.ts`](./test/app.test.ts) also asserts that every synthesised
template is ASCII-only. That needs no registry and covers nested paths and
unregistered types alike, which makes it the real backstop. The policy earns
its place by failing `cdk synth` with the construct path and field named,
rather than pointing at a template full of JSON.

### First-time setup

A new AWS account needs `cdk bootstrap` run once per region the app deploys
into. This app spans two regions, so bootstrap both:

```sh
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
npx cdk bootstrap aws://$ACCOUNT/eu-west-2   # DNS + Site stacks
npx cdk bootstrap aws://$ACCOUNT/us-east-1   # Cert + alarm stacks (CloudFront requirement)
```

For the very first deploy, deploy the DNS stack alone first so you can read
its nameservers before delegating:

```sh
npm run cdk:deploy:stack -- UkehootNetDnsStack
```

Then proceed with [Domain delegation](#domain-delegation) below before
deploying the remaining stacks (the certificate's DNS validation succeeds
automatically once delegation lands).

## Continuous deployment

`main` auto-deploys via GitHub Actions:

- **`.github/workflows/pr.yml`** — runs on every PR: lint, format, build,
  test, plus `cdk diff` posted as a comment so infra changes are visible at
  review time.
- **`.github/workflows/deploy.yml`** — runs on push to `main`: full verify,
  fresh `site:build` (with `GITHUB_SHA` baked into a `<meta name="build-sha">`
  tag), `cdk deploy --all`, post-deploy smoke test, redirect compatibility
  check, and IndexNow ping. A failure on any step fails the workflow; GitHub
  emails the repo owner by default.

Both workflows authenticate to AWS via OpenID Connect — there are no
long-lived AWS keys in GitHub. The OIDC provider and the deploy role are
managed as a CDK stack (`UkehootNetCiOidcStack`) so the trust policy lives in
source control. Third-party action versions are pinned to commit SHAs (with
`# vX.Y.Z` comments that Dependabot can read) so a tag rewrite upstream
cannot silently change what runs in CI.

### CI bootstrap (one-time)

After the standard `cdk bootstrap` in [First-time setup](#first-time-setup),
deploy the OIDC stack locally:

```sh
ALERT_EMAIL=alert@jasonduffett.org npm run cdk:deploy:stack -- UkehootNetCiOidcStack
```

The stack outputs `GitHubActionsDeployRoleArn`. Configure GitHub:

- **Repository secrets** (Settings → Secrets and variables → Actions → Secrets):
  - `AWS_DEPLOY_ROLE_ARN` — the role ARN from the stack output.
  - `ALERT_EMAIL` — same address used for the alarm topics.
  - `INDEXNOW_KEY` — the IndexNow key (matches `packages/site/static/<key>.txt`).
- **Repository variables** (same page → Variables tab):
  - `GA_MEASUREMENT_ID` — `G-XXXXXXXXXX` (public; not a secret).
- **Branch protection on `main`** (Settings → Branches): require a pull
  request before merging and require the `verify` and `cdk diff` status
  checks to pass.

The deploy role's trust policy is restricted to two exact subject claims —
`repo:laazyj/ukehoot.net:ref:refs/heads/main` and
`repo:laazyj/ukehoot.net:pull_request` — so forks run workflows under their
own OIDC namespace and cannot assume the role. Making the repository public
does not expand who can deploy.

## Domain delegation

To delegate the zone to Route 53, point the domain's NS records at the
hosted-zone name servers:

1. Read the new name servers from the stack output:

   ```sh
   aws cloudformation describe-stacks \
     --stack-name UkehootNetDnsStack \
     --query "Stacks[0].Outputs[?OutputKey=='NameServers'].OutputValue" \
     --output text
   ```

2. At the registrar, replace the existing NS records with the four AWS NS
   hostnames from step 1 (no trailing dot).

3. Wait for propagation (typically minutes; up to a couple of hours). Verify with:

   ```sh
   dig +trace @1.1.1.1 ukehoot.net NS    # bottom should show the AWS nameservers
   ```

4. Smoke-test the live site once delegation has propagated:

   ```sh
   curl -I https://ukehoot.net/
   curl -I https://www.ukehoot.net/             # 301 → apex
   dig MX ukehoot.net                           # mail still resolves to mailserver.livemail.co.uk
   dig TXT livemail1._domainkey.ukehoot.net     # DKIM points at the Livemail mailbox
   ```

## Tests

```sh
npx nx run @ukehoot-net/cdk:test
```

Two test files:

- [`test/app.test.ts`](./test/app.test.ts) — synthesises every stack, snapshots
  the CloudFormation, and adds functional assertions for invariants that must
  hold regardless of refactors (certificate SANs, budget limit, alarm coverage,
  OIDC trust policy).
- [`test/redirects.test.ts`](./test/redirects.test.ts) — validates the shape of
  [`redirects.json`](./redirects.json) at build time, so bad data fails the
  test rather than reaching the deployed CloudFront Function (which has a
  sub-millisecond CPU budget per request).

After intentional infra changes, regenerate snapshots with
`npx nx run @ukehoot-net/cdk:test -- -u`.

## Linting and formatting

Inherits the root ESLint and Prettier configs. Run `npm run lint` /
`npm run format:check` from the repo root.

## See also

- [Top-level README](../../README.md) — repo overview.
- [`@ukehoot-net/site`](../site/README.md) — the Eleventy site this CDK app
  hosts.
- [composureCDK](https://github.com/laazyj/composureCDK) — the framework used
  here.
