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

- `npm run build` — build all packages.
- `npm run typecheck` — typecheck all packages.
- `npm test` — run tests across all packages.
- `npm run clean` — remove build outputs across all packages.
- `npm run lint` / `npm run lint:fix` — ESLint across the repo.
- `npm run format` / `npm run format:check` — Prettier across the repo.
- `npm run synth` / `npm run diff` / `npm run deploy` — CDK targets (build runs automatically as a dependency).
- `npm run verify` — format check, build, lint, and test (CI parity).

See [AGENTS.md](./AGENTS.md) for contributor instructions.
