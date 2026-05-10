import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface RedirectsFile {
  redirects: unknown;
}

/**
 * Loads and validates the legacy-URL map from `redirects.json` at synth time.
 * Returns a plain `from → to` map; the values are serialised inline into the
 * CloudFront Function source by `buildRedirectFunctionCode`.
 *
 * Synth-time only: this module is never bundled into the deployed Function.
 */
export function loadRedirects(): Record<string, string> {
  const path = resolve(import.meta.dirname, "..", "redirects.json");
  const file = JSON.parse(readFileSync(path, "utf8")) as RedirectsFile;
  return validateRedirects(file.redirects);
}

/**
 * Validates the parsed redirect map. We deliberately do *not* validate inside
 * the deployed CloudFront Function — that runs on every viewer request under
 * a sub-millisecond CPU budget, so anything we can catch at build time stays
 * at build time.
 *
 * Exported for direct test coverage (see `test/redirects.test.ts`).
 */
export function validateRedirects(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("redirects.json: `redirects` must be an object.");
  }
  const result: Record<string, string> = {};
  for (const [from, to] of Object.entries(value as Record<string, unknown>)) {
    if (typeof from !== "string" || !from.startsWith("/")) {
      throw new Error(`redirects.json: key must start with "/" (got ${JSON.stringify(from)}).`);
    }
    if (typeof to !== "string" || to.length === 0) {
      throw new Error(`redirects.json: value for ${from} must be a non-empty string.`);
    }
    if (from === to) {
      throw new Error(`redirects.json: ${from} redirects to itself.`);
    }
    result[from] = to;
  }
  // Two-hop redirects can't be served by the function as written (it returns
  // after the first match), and they also produce slow client experiences —
  // catch the data error at build time.
  for (const [from, to] of Object.entries(result)) {
    if (Object.prototype.hasOwnProperty.call(result, to)) {
      throw new Error(
        `redirects.json: ${from} → ${to} is a two-hop chain (target is itself a redirect key).`,
      );
    }
  }
  return result;
}
