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
  _Added in a follow-up PR._
- `packages/site` — Eleventy-built blog and landing site. _Added in a follow-up PR._

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
