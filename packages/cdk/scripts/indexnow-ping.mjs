#!/usr/bin/env node
// Post-deploy notification: tell IndexNow (Bing, Yandex, Naver, etc.) that
// the sitemap is fresh. Submitting the sitemap URL itself is the simplest
// valid payload — IndexNow pulls the full URL list from the sitemap, so we
// don't need to diff against the previous deploy.
//
// Usage:
//   INDEXNOW_KEY=<key> node packages/cdk/scripts/indexnow-ping.mjs
//   INDEXNOW_KEY=<key> BASE_URL=https://staging.example.com node ...
//
// Failures are logged but the script always exits 0 — IndexNow is a latency
// optimisation, not the source of truth (Bing falls back to sitemap polling).

import { fetchWithTimeout, resolveBaseUrl } from "./_lib.mjs";

const { baseUrl: BASE_URL } = resolveBaseUrl();
const KEY = process.env.INDEXNOW_KEY;

if (!KEY) {
  console.error(
    "INDEXNOW_KEY env var is required (see packages/site/static/<key>.txt for the value).",
  );
  process.exit(1);
}

const host = new URL(BASE_URL).host;
const keyLocation = `${BASE_URL}/${KEY}.txt`;
const sitemapUrl = `${BASE_URL}/sitemap.xml`;

const body = {
  host,
  key: KEY,
  keyLocation,
  urlList: [sitemapUrl],
};

console.log(`IndexNow: pinging api.indexnow.org for ${host} (sitemap: ${sitemapUrl})`);

try {
  const res = await fetchWithTimeout("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (res.status === 200 || res.status === 202) {
    console.log(`IndexNow: ${res.status} ${res.statusText} (accepted).`);
  } else {
    console.warn(
      `IndexNow: unexpected ${res.status} ${res.statusText}. Body: ${text || "(empty)"}`,
    );
    console.warn("Continuing — Bing will still discover updates via the sitemap.");
  }
} catch (err) {
  console.warn(`IndexNow: ping failed: ${String(err)}`);
  console.warn("Continuing — Bing will still discover updates via the sitemap.");
}
