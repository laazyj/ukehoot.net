#!/usr/bin/env node
// Post-deploy smoke test: verify the live site is healthy after a deploy.
//
// Probes (each with retry/backoff to absorb CloudFront invalidation):
//   1. Homepage 200 + site title + matching <meta name="build-sha">
//   2. RSS feed 200 + valid XML with at least one <item>/<entry>
//   3. Sitemap 200 + valid XML with at least one <loc>
//   4. Sample of sitemap URLs all return 200
//   5. Unknown path returns 404 + custom 404 page body
//   6. www -> apex 301 canonicalisation
//
// Env:
//   BASE_URL          default https://ukehoot.net
//   EXPECTED_SHA      git sha to assert against the meta tag (skip when unset)
//   SMOKE_RETRIES     default 6
//   SMOKE_RETRY_MS    default 5000
//   SMOKE_SAMPLE      sitemap URLs to sample (default 10, 0 disables)
//   SMOKE_CONCURRENCY concurrent probes for the sitemap sample (default 5)
//
// Exits non-zero on any failure.

import { setTimeout as sleep } from "node:timers/promises";

import { CANONICAL_HOST, fetchWithTimeout, pool, resolveBaseUrl } from "./_lib.mjs";

const SITE_TITLE = "Uke hOOt";
const NOT_FOUND_MARKER = "Not found";

const { baseUrl: BASE_URL, apex, wwwHost, isCanonicalApex: checkWww } = resolveBaseUrl();
const EXPECTED_SHA = process.env.EXPECTED_SHA ?? "";
const SMOKE_RETRIES = Number(process.env.SMOKE_RETRIES ?? "6");
const SMOKE_RETRY_MS = Number(process.env.SMOKE_RETRY_MS ?? "5000");
const SAMPLE_COUNT = Number(process.env.SMOKE_SAMPLE ?? "10");
const CONCURRENCY = Number(process.env.SMOKE_CONCURRENCY ?? "5");

/** @typedef {{ name: string; ok: boolean; detail?: string }} Result */

const results = [];

/** @param {string} name @param {() => Promise<void>} fn */
async function step(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    results.push({ name, ok: false, detail });
    console.log(`  ✗ ${name}\n      ${detail}`);
  }
}

/** @param {string} name @param {() => Promise<void>} fn */
async function withRetry(name, fn) {
  let last;
  for (let i = 0; i <= SMOKE_RETRIES; i++) {
    try {
      await fn();
      return;
    } catch (err) {
      last = err;
      if (i < SMOKE_RETRIES) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`    [retry ${i + 1}/${SMOKE_RETRIES}] ${name}: ${msg}`);
        await sleep(SMOKE_RETRY_MS);
      }
    }
  }
  throw last;
}

/** @param {string} url @param {RequestInit} init */
async function request(url, init = {}) {
  return fetchWithTimeout(url, { redirect: "manual", ...init });
}

function expect(cond, message) {
  if (!cond) throw new Error(message);
}

/** Crude but dependency-free: pull `<loc>…</loc>` values from a sitemap. */
function extractLocs(xml) {
  const out = [];
  const re = /<loc>\s*([^<\s][^<]*)\s*<\/loc>/g;
  let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1].trim());
  return out;
}

/** @template T @param {T[]} items @param {number} n */
function sample(items, n) {
  if (n <= 0 || items.length <= n) return [...items];
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

console.log(
  `Smoke testing ${BASE_URL}${EXPECTED_SHA ? ` (sha=${EXPECTED_SHA.slice(0, 7)})` : ""} …`,
);

// -------- 1. Homepage (with SHA assertion + retries for cache propagation) --------
await step("homepage 200 + title" + (EXPECTED_SHA ? " + build-sha" : ""), async () => {
  await withRetry("homepage", async () => {
    const res = await request(`${BASE_URL}/`, { redirect: "follow" });
    expect(res.status === 200, `expected 200, got ${res.status}`);
    const ct = res.headers.get("content-type") ?? "";
    expect(ct.includes("text/html"), `expected text/html content-type, got "${ct}"`);
    const body = await res.text();
    expect(body.includes(SITE_TITLE), `homepage missing site title "${SITE_TITLE}"`);
    if (EXPECTED_SHA) {
      const tag = `<meta name="build-sha" content="${EXPECTED_SHA}"`;
      expect(
        body.includes(tag),
        `homepage build-sha mismatch (looking for ${tag}); cache may still be propagating`,
      );
    }
  });
});

// -------- 2. RSS feed --------
await step("rss feed 200 + >=1 item", async () => {
  const res = await request(`${BASE_URL}/feed.xml`, { redirect: "follow" });
  expect(res.status === 200, `expected 200, got ${res.status}`);
  const xml = await res.text();
  expect(/<rss\b/i.test(xml) || /<feed\b/i.test(xml), `feed body is not RSS or Atom`);
  const items = (xml.match(/<item\b/gi) ?? []).length + (xml.match(/<entry\b/gi) ?? []).length;
  expect(items >= 1, `feed has zero items/entries`);
});

// -------- 3. Sitemap --------
let sitemapLocs = [];
await step("sitemap 200 + >=1 url", async () => {
  const res = await request(`${BASE_URL}/sitemap.xml`, { redirect: "follow" });
  expect(res.status === 200, `expected 200, got ${res.status}`);
  const xml = await res.text();
  expect(/<urlset\b/i.test(xml), `sitemap is not a <urlset>`);
  sitemapLocs = extractLocs(xml);
  expect(sitemapLocs.length >= 1, `sitemap has zero <loc> entries`);
});

// -------- 4. Sampled pages --------
await step(
  `sampled pages 200 (${Math.min(SAMPLE_COUNT, sitemapLocs.length)} of ${sitemapLocs.length})`,
  async () => {
    if (sitemapLocs.length === 0) {
      throw new Error("no sitemap urls available to sample");
    }
    const targets = sample(sitemapLocs, SAMPLE_COUNT);
    /** @type {string[]} */
    const failures = [];
    await pool(targets, CONCURRENCY, async (url) => {
      try {
        const res = await request(url, { method: "HEAD", redirect: "follow" });
        if (res.status !== 200) failures.push(`${url} → ${res.status}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        failures.push(`${url} → error: ${msg}`);
      }
    });
    expect(failures.length === 0, `${failures.length} failed:\n      ${failures.join("\n      ")}`);
  },
);

// -------- 5. 404 path serves custom 404 page --------
await step("unknown path → 404 + custom 404 body", async () => {
  const probePath = `/__smoke-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await request(`${BASE_URL}${probePath}`, { redirect: "follow" });
  expect(res.status === 404, `expected 404, got ${res.status}`);
  const body = await res.text();
  expect(
    body.includes(NOT_FOUND_MARKER),
    `404 body missing marker "${NOT_FOUND_MARKER}" — wrong page served?`,
  );
});

// -------- 6. www → apex canonicalisation --------
if (checkWww) {
  await step("www → apex 301", async () => {
    const res = await request(`https://${wwwHost}/`);
    expect(res.status === 301, `expected 301, got ${res.status}`);
    const loc = res.headers.get("location");
    expect(loc !== null, `redirect missing Location header`);
    const target = new URL(loc, `https://${wwwHost}`);
    expect(target.host === apex, `expected redirect to apex (${apex}), got ${target.host}`);
  });
} else {
  console.log(`  - www → apex skipped (BASE_URL host ${apex} != ${CANONICAL_HOST})`);
}

// -------- summary --------
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed.`);
if (failed.length > 0) {
  process.exit(1);
}
