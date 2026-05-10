#!/usr/bin/env node
// Post-deploy validation: hit each entry in redirects.json on the live site
// and confirm CloudFront returns a 301 to the expected new path. Also probes
// the www -> apex canonicalisation.
//
// Usage:
//   node packages/cdk/scripts/check-redirects.mjs
//   BASE_URL=https://ukehoot.net node packages/cdk/scripts/check-redirects.mjs
//   CHECK_TARGET=1 node ...   # also GETs each new URL and expects 200
//
// Exits non-zero if any check fails.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CANONICAL_HOST, fetchWithTimeout, pool, resolveBaseUrl } from "./_lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const redirectsPath = resolve(here, "..", "redirects.json");

// The CloudFront Function's www -> apex rewrite is baked in at synth time
// against the canonical apex, so probing it only makes sense when BASE_URL
// resolves to that same host (i.e. post-cutover prod). Against the bare
// distribution URL or a staging clone we auto-skip that one probe.
const { baseUrl: BASE_URL, apex, wwwHost, isCanonicalApex: checkWww } = resolveBaseUrl();
const CHECK_TARGET = process.env.CHECK_TARGET === "1";
const CONCURRENCY = Number(process.env.CONCURRENCY ?? "10");

/** @type {{ redirects: Record<string, string> }} */
const { redirects } = JSON.parse(readFileSync(redirectsPath, "utf8"));

/** @param {string} url */
async function probe(url) {
  const res = await fetchWithTimeout(url, { method: "HEAD", redirect: "manual" });
  return { status: res.status, location: res.headers.get("location") };
}

/**
 * Compare the Location header against the expected target. CloudFront returns
 * the raw value the function set, which is a path-only string for old-URL
 * redirects and an absolute URL for www -> apex. Accept either form.
 *
 * @param {string | null} actual
 * @param {string} expectedPath
 */
function locationMatches(actual, expectedPath) {
  if (!actual) return false;
  if (actual === expectedPath) return true;
  try {
    const u = new URL(actual, BASE_URL);
    return u.pathname === expectedPath && u.host === apex;
  } catch {
    return false;
  }
}

const failures = [];
let passed = 0;

const pathEntries = Object.entries(redirects);
console.log(`Checking ${pathEntries.length} path redirects against ${BASE_URL} …`);

await pool(pathEntries, CONCURRENCY, async ([oldPath, newPath]) => {
  const url = BASE_URL + oldPath;
  try {
    const { status, location } = await probe(url);
    if (status !== 301 || !locationMatches(location, newPath)) {
      failures.push({
        url,
        expected: `301 -> ${newPath}`,
        got: `${status} -> ${location ?? "(none)"}`,
      });
      process.stdout.write("F");
    } else {
      passed++;
      process.stdout.write(".");
    }
  } catch (err) {
    failures.push({ url, expected: `301 -> ${newPath}`, got: `error: ${String(err)}` });
    process.stdout.write("E");
  }
});
process.stdout.write("\n");

// www -> apex (only meaningful when BASE_URL is the canonical apex)
if (checkWww) {
  console.log("Checking www -> apex canonicalisation …");
  const wwwProbePath = pathEntries[0]?.[0] ?? "/";
  try {
    const { status, location } = await probe(`https://${wwwHost}${wwwProbePath}`);
    const expected = `${BASE_URL}${wwwProbePath}`;
    if (status !== 301 || location !== expected) {
      failures.push({
        url: `https://${wwwHost}${wwwProbePath}`,
        expected: `301 -> ${expected}`,
        got: `${status} -> ${location ?? "(none)"}`,
      });
    } else {
      passed++;
    }
  } catch (err) {
    failures.push({
      url: `https://${wwwHost}${wwwProbePath}`,
      expected: `301 -> apex`,
      got: `error: ${String(err)}`,
    });
  }
} else {
  console.log(`Skipping www -> apex probe (BASE_URL host ${apex} != ${CANONICAL_HOST}).`);
}

// Optional: confirm each new URL actually serves a page.
if (CHECK_TARGET) {
  console.log(`Checking ${pathEntries.length} redirect targets return 200 …`);
  const targets = [...new Set(pathEntries.map(([, t]) => t))];
  await pool(targets, CONCURRENCY, async (target) => {
    const url = BASE_URL + target;
    try {
      const { status } = await probe(url);
      if (status !== 200) {
        failures.push({ url, expected: "200", got: String(status) });
        process.stdout.write("F");
      } else {
        passed++;
        process.stdout.write(".");
      }
    } catch (err) {
      failures.push({ url, expected: "200", got: `error: ${String(err)}` });
      process.stdout.write("E");
    }
  });
  process.stdout.write("\n");
}

console.log(`\n${passed} passed, ${failures.length} failed.`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) {
    console.log(`  ${f.url}\n    expected: ${f.expected}\n    got:      ${f.got}`);
  }
  process.exit(1);
}
