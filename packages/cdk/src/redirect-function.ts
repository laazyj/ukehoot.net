/**
 * Builds the source for a CloudFront Function (viewer-request stage) that
 * canonicalises `www.{domain}` → apex, looks up old-URL 301 redirects from
 * the associated CloudFront KeyValueStore, and rewrites pretty URLs to their
 * `index.html` so S3 can serve them.
 *
 * The redirect map is stored in the KVS (not inlined here) because the
 * historical Tumblr map exceeds the 10 KB CloudFront Function code limit.
 *
 * **Runtime:** requires `cloudfront-js-2.0` plus an associated KeyValueStore.
 *
 * **Deploy boundary:** only the string between the backticks below ships to
 * CloudFront. Everything else in this file (and any module it imports) runs
 * at synth time on the build host.
 */
export function buildRedirectFunctionCode(domain: string): string {
  const wwwHost = JSON.stringify(`www.${domain}`);
  const apexOrigin = JSON.stringify(`https://${domain}`);

  return `
import cf from "cloudfront";

var WWW_HOST = ${wwwHost};
var APEX_ORIGIN = ${apexOrigin};
var POST_RE = /^(\\/post\\/\\d+)(?:\\/|$)/;
var kvs = cf.kvs();

async function handler(event) {
  var req = event.request;
  var host = req.headers.host && req.headers.host.value;
  var uri = req.uri;

  if (host === WWW_HOST) {
    return {
      statusCode: 301,
      statusDescription: "Moved Permanently",
      headers: {
        location: { value: APEX_ORIGIN + uri }
      }
    };
  }

  var lastSlash = uri.lastIndexOf("/");
  var lastDot = uri.lastIndexOf(".");
  var hasExtension = lastDot > lastSlash;

  // Skip the KVS lookup for static assets (anything with a file extension);
  // every redirect key is /post/<digits> with no extension, so an extensioned
  // URI cannot match — saves an async hop on the bulk of viewer requests.
  if (!hasExtension) {
    // Tumblr exposed posts at both /post/<id> and /post/<id>/<slug>; the KVS
    // stores one entry per <id> and we strip any trailing slug here.
    var m = uri.match(POST_RE);
    var key = m ? m[1] : uri;
    try {
      var target = await kvs.get(key);
      return {
        statusCode: 301,
        statusDescription: "Moved Permanently",
        headers: {
          location: { value: target }
        }
      };
    } catch (e) {
      // Key not present in the store — fall through to S3 origin.
    }
  }

  // Eleventy emits pretty URLs as <path>/index.html. CloudFront's
  // defaultRootObject only rewrites "/" → "/index.html", so map directory-
  // style requests onto their index file before the S3 origin sees them.
  if (uri.endsWith("/")) {
    req.uri = uri + "index.html";
  } else if (!hasExtension) {
    req.uri = uri + "/index.html";
  }

  return req;
}
`.trim();
}

/**
 * Renders the redirect map in the JSON shape that CloudFront's KeyValueStore
 * `ImportSource` accepts: `{ "data": [{ "key": "...", "value": "..." }, …] }`.
 *
 * Synth-time only.
 */
export function buildKvsImportData(redirects: Record<string, string>): string {
  return JSON.stringify({
    data: Object.entries(redirects).map(([key, value]) => ({ key, value })),
  });
}
