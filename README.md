# ukehoot.net

[![Built with ComposureCDK](https://img.shields.io/badge/built%20with-ComposureCDK-0f0d0c?labelColor=b85416)](https://github.com/laazyj/composureCDK)
[![Code: MIT](https://img.shields.io/badge/code-MIT-blue.svg)](LICENSE)
[![Content: contributors](https://img.shields.io/badge/content-%C2%A9%20contributors-lightgrey.svg)](LICENSE-content.md)

Monorepo for [ukehoot.net](https://ukehoot.net/) — the website for
**Uke hOOt**, Edinburgh's weekly ukulele jam, plus the AWS infrastructure
that hosts it.

## About the site

Uke hOOt is a weekly ukulele jam that's met on Wednesday evenings in Edinburgh
since 2012. No audition, beginners welcome, advanced players welcome, songbooks
on the table. The site is the public archive of the jam: an
[about/contact page](https://ukehoot.net/about/), photos and notes from
sessions, and the migrated post archive from the group's original Tumblr
(2012–2018). Old `ukehoot.tumblr.com/post/…` URLs 301 to their archived
counterparts on the new site, served from CloudFront in front of an S3 bucket
of Eleventy-rendered HTML.

This repo doubles as a working example of
[composureCDK](https://github.com/laazyj/composureCDK) — a multi-region,
multi-stack system composed declaratively from independent builders. If you're
here for the infrastructure, see
[`packages/cdk/README.md`](./packages/cdk/README.md).

This is a personal project and is **not accepting external contributions**.
Feel free to fork, adapt, or open issues with questions about the composureCDK
patterns. Security issues: see [`SECURITY.md`](SECURITY.md).

## Packages

- [`packages/site`](./packages/site/README.md) — the Eleventy archive site:
  posts, layouts, local dev.
- [`packages/cdk`](./packages/cdk/README.md) — the AWS CDK app: DNS, ACM
  certificate, CloudFront + S3, alarms, GitHub OIDC role. Deploy and CI
  bootstrap docs live here.

## Quick start

From the repo root:

```sh
npm install                # also wires the husky pre-commit hook
npm run site:start         # hot-reload dev server at http://localhost:8080
npm run verify             # format check, build, lint, test (CI parity)
```

Pushes to `main` deploy automatically via the GitHub Actions workflows in
[`.github/workflows/`](./.github/workflows). The full deploy / first-time
setup / domain-delegation runbooks live in
[`packages/cdk/README.md`](./packages/cdk/README.md).

## Pre-commit secret scan

A husky-managed pre-commit hook runs [gitleaks](https://github.com/gitleaks/gitleaks)
against staged changes (config in [`.gitleaks.toml`](.gitleaks.toml); allowlist
covers DNS verification tokens and the IndexNow ownership file, all of which
are public by design). `npm install` wires the hook automatically; you only
need gitleaks installed on `PATH`:

```sh
brew install gitleaks    # macOS
# or download a release from https://github.com/gitleaks/gitleaks/releases
```

GitHub's server-side secret scanning + push protection runs as a second layer.
The pre-commit hook stops accidental leaks before they leave the laptop;
GitHub catches anything that slips through.

## License

Code (CDK app, Eleventy config, build scripts) is licensed under the
[MIT licence](LICENSE).

Site content under `packages/site/content/posts/` is contributed by many
members of the Uke hOOt community and remains © its respective authors —
**no collective licence is granted** over the post content. See
[`LICENSE-content.md`](LICENSE-content.md) for the full statement and reuse
guidance.

See [AGENTS.md](./AGENTS.md) for contributor instructions.
