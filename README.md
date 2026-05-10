# ukehoot.net

[![Built with ComposureCDK](https://img.shields.io/badge/built%20with-ComposureCDK-0f0d0c?labelColor=b85416)](https://github.com/laazyj/composureCDK)

Monorepo for `ukehoot.net` — infrastructure and blog for **Uke hOOt**, Edinburgh's weekly
ukulele jam. Successor to https://ukehoot.tumblr.com/.

The AWS infrastructure under `packages/cdk` is built with
[composureCDK](https://github.com/laazyj/composureCDK): a multi-region, multi-stack
system composed declaratively from independent builders. The wiring lives in
[`packages/cdk/src/system.ts`](packages/cdk/src/system.ts).

## Packages

- `packages/cdk` — AWS CDK app managing the domain, DNS, and site hosting (CloudFront + S3).
- `packages/site` — Eleventy-built blog and landing site.

## Scripts

Nx orchestrates all per-package work (build/test/typecheck/clean) and caches results. The
root `npm run` scripts below delegate to Nx — prefer them over invoking workspace scripts
directly so you benefit from the task graph and cache.

Cross-cutting:

- `npm run build` — build all packages.
- `npm run typecheck` — typecheck all packages.
- `npm test` / `npm run test:update` — run tests across all packages (`:update` regenerates snapshots).
- `npm run clean` — remove build outputs across all packages.
- `npm run lint` / `npm run lint:fix` — ESLint across the repo.
- `npm run format` / `npm run format:check` — Prettier across the repo.
- `npm run verify` — format check, build, lint, and test (CI parity).

Site (`site:*`):

- `npm run site:start` / `npm run site:build` / `npm run site:clean`.
- `npm run site:check-redirects` — validate live 301s match `packages/cdk/redirects.json`.

CDK (`cdk:*`) — each runs the cdk build + site build first via Nx's task graph:

- `npm run cdk:synth` — render CloudFormation for all stacks.
- `npm run cdk:diff` — preview changes for all stacks.
- `npm run cdk:deploy` — deploy **all** stacks.
- `npm run cdk:deploy:stack -- <StackName>` — escape hatch for a single stack.

To target a single package or run only affected projects, use Nx directly:

```sh
npx nx run @ukehoot-net/cdk:test         # one project, one target
npx nx affected -t build test lint       # only projects touched since main
npx nx graph                             # open the task/dependency graph
```

See [AGENTS.md](./AGENTS.md) for contributor instructions.

## Deploying

Deploys are automated. Push to `main` triggers `.github/workflows/deploy.yml`,
which runs `npm run verify`, `cdk deploy --all`, then post-deploy smoke tests,
redirect probes, and an IndexNow ping. PRs run `.github/workflows/pr.yml`, which
verifies and posts a `cdk diff` comment.

Both workflows authenticate to AWS via OIDC. The `UkehootNetCiOidcStack` provisions
the GitHub OIDC provider and the `GitHubActionsDeployRole` whose ARN is wired into
the `AWS_DEPLOY_ROLE_ARN` repo secret. That stack must be deployed once from a
workstation before the workflows can authenticate (see [First-time setup](#first-time-setup)).

To deploy a single stack manually (escape hatch):

```sh
export AWS_PROFILE=ukehoot.net
export ALERT_EMAIL=alert@jasonduffett.org
npm run cdk:deploy:stack -- UkehootNetSiteStack
```

The CDK app reads the standard `CDK_DEFAULT_ACCOUNT` / `CDK_DEFAULT_REGION` environment
variables, plus `ALERT_EMAIL` (the address subscribed to both alarm topics — synth
fails if it is unset).

After the first deploy, AWS sends one confirmation email per topic (us-east-1 and
eu-west-2). Click both confirm links — alerts only flow once the subscriptions are
in the `Confirmed` state.

### Reviewing infra changes

`packages/cdk/test/app.test.ts` snapshots the synthesised CloudFormation for every
stack. Any change that affects the templates (DNS records, alarm thresholds, distribution
config) shows up in the snapshot diff in the PR. If you intend the change, regenerate
with `npm run test:update`. If you don't, you have a regression.

### First-time setup

A new AWS account needs `cdk bootstrap` run once per region the app deploys into. This
app spans two regions, so bootstrap both:

```sh
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
npx cdk bootstrap aws://$ACCOUNT/eu-west-2   # DNS + Site stacks
npx cdk bootstrap aws://$ACCOUNT/us-east-1   # Cert + alarm stacks (CloudFront requirement)
```

For the very first deploy, deploy the DNS stack alone first so you can read its
nameservers before delegating:

```sh
npm run cdk:deploy:stack -- UkehootNetDnsStack
```

Then proceed with [Domain delegation](#domain-delegation) below before deploying the
remaining stacks (the certificate's DNS validation succeeds automatically once
delegation lands).

### Bootstrapping CI/CD

The GitHub Actions workflows assume an IAM role minted by `UkehootNetCiOidcStack`.
That stack has to be deployed once from a workstation:

```sh
npm run cdk:deploy:stack -- UkehootNetCiOidcStack
```

The stack's `GitHubActionsDeployRoleArn` output is the value for the
`AWS_DEPLOY_ROLE_ARN` GitHub repo secret. Configure the rest under Settings →
Secrets and variables → Actions:

- Secret `AWS_DEPLOY_ROLE_ARN` — role ARN from the stack output above.
- Secret `ALERT_EMAIL` — `alert@jasonduffett.org`.
- Secret `INDEXNOW_KEY` — a 32-char hex key. Also commit
  `packages/site/static/<INDEXNOW_KEY>.txt` containing the same value (IndexNow
  fetches this URL to verify domain ownership). Without the file the ping is
  rejected; the deploy step exits 0 either way.
- Variable `GA_MEASUREMENT_ID` — the GA4 measurement ID (or leave unset; the
  site degrades gracefully).

Add a branch protection rule on `main` requiring the `verify` and `cdk diff`
status checks before merge.

## Domain delegation

To delegate the zone to Route 53, point the domain's NS records at the hosted-zone
name servers:

1. Read the new name servers:

   ```sh
   aws route53 list-hosted-zones-by-name --dns-name ukehoot.net \
     --query 'HostedZones[0].Id' --output text
   aws route53 get-hosted-zone --id <id-from-above> \
     --query 'DelegationSet.NameServers'
   ```

2. At the registrar, replace the existing NS records with the four AWS NS hostnames
   from step 1 (no trailing dot).

3. Wait for propagation (typically minutes; up to a couple of hours). Verify with:

   ```sh
   dig +trace @1.1.1.1 ukehoot.net NS    # bottom should show the AWS nameservers
   ```

4. Smoke-test the live site once delegation has propagated:

   ```sh
   curl -I https://ukehoot.net/
   curl -I https://www.ukehoot.net/      # 301 → apex
   dig MX ukehoot.net                    # mail still resolves to mailserver.livemail.co.uk
   dig TXT livemail1._domainkey.ukehoot.net  # DKIM points at mailbox 144548
   ```
