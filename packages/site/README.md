# `@ukehoot-net/site`

The Eleventy archive site that gets uploaded to S3 and served via CloudFront.
Posts are Markdown, layouts are Nunjucks.

## Layout

| Path                 | What's there                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `content/posts/`     | Posts grouped by year (`2012/`, `2013/`, …). Each post is `<YYYY>/<YYYY-MM-DD>-<slug>/index.md` with any photos sitting alongside as `photo-1.jpg` etc. |
| `content/`           | Standalone pages: `about.md`, `index.njk`, `404.md`, `feed.njk`, `sitemap.njk`, `archive.njk`, `year.njk`, `robots.njk`.                                |
| `_data/`             | Site-wide data (`site.json`).                                                                                                                           |
| `_includes/`         | Shared layouts and partials.                                                                                                                            |
| `assets/`            | Images and static assets that Eleventy fingerprints / processes.                                                                                        |
| `static/`            | Files copied through unchanged (favicons, IndexNow verification file).                                                                                  |
| `scripts/`           | Build-time helpers — currently the one-shot Tumblr importer (`import-tumblr.mjs`) that produced the migrated archive and `packages/cdk/redirects.json`. |
| `eleventy.config.js` | Eleventy configuration.                                                                                                                                 |

Permalinks for posts come from
[`content/posts/posts.11tydata.js`](./content/posts/posts.11tydata.js) —
`/posts/<YYYY>/<slug>/` mirrors the on-disk layout so `<img src="photo-1.jpg">`
resolves without further plumbing.

## Local development

From the repo root:

```sh
npm run site:start    # hot-reload dev server at http://localhost:8080
npm run site:build    # one-shot build to packages/site/dist
```

Optional environment variables (see [`.env.example`](./.env.example)):

- `GA_MEASUREMENT_ID` — `G-XXXXXXXXXX`. When set at build time, opt-in Google
  Analytics 4 + the cookie consent banner are emitted. Leave unset for an
  analytics-free build.
- `GITHUB_SHA` — baked into a `<meta name="build-sha">` tag and asserted by
  the post-deploy smoke test. CI sets this automatically; locally it's optional.

## Styling

There is a single stylesheet, [`assets/styles.css`](./assets/styles.css). The
`inlineFile` shortcode inlines it into every page's `<style>` (one fewer request,
instant first paint), and it is also passed through to `/assets/styles.css`.

CSS is linted with [stylelint](https://stylelint.org/)
(`stylelint-config-standard`); config lives in
[`.stylelintrc.json`](../../.stylelintrc.json) at the repo root. As with ESLint
and Prettier, it runs across the whole monorepo from the root and is part of
`npm run lint` / `npm run verify`:

```sh
npm run lint:css        # check only CSS
npm run lint:css:fix    # auto-fix
```

Prettier owns whitespace/formatting; stylelint focuses on CSS correctness and
modern syntax, so the two don't overlap. The standard kebab-case naming check is
widened to allow BEM `__element` / `--modifier` class names.

## Adding a post

1. Create `content/posts/<YYYY>/<YYYY-MM-DD>-<slug>/index.md`.
2. Frontmatter follows existing posts in the same year. To redirect a legacy
   Tumblr URL, set `originalUrl: https://ukehoot.tumblr.com/post/<id>/<slug>` —
   the importer-generated entries in
   [`packages/cdk/redirects.json`](../cdk/redirects.json) are the canonical
   list and the CloudFront Function 301s old paths to the new permalink.
3. Drop any photos next to `index.md` (`photo-1.jpg`, `photo-2.jpg`, …).
4. `npm run site:start` to preview.

## See also

- [Top-level README](../../README.md) — repo overview.
- [`@ukehoot-net/cdk`](../cdk/README.md) — infrastructure, deploy, redirects.
- [Content rights](../../LICENSE-content.md) — posts remain © their authors.
