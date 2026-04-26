import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface RedirectsFile {
  redirects: Record<string, string>;
}

/**
 * Builds the source for a CloudFront Function (viewer-request stage) that
 * canonicalises `www.{domain}` → apex, serves the compiled-in old-URL 301
 * map, and rewrites pretty URLs to their `index.html` so S3 can serve them.
 * The redirect map is injected at synth time because CloudFront Functions
 * cannot make network calls.
 */
export function buildRedirectFunctionCode(domain: string): string {
  const redirectsPath = resolve(import.meta.dirname, "..", "redirects.json");
  const file = JSON.parse(readFileSync(redirectsPath, "utf8")) as RedirectsFile;

  const redirectMapSource = JSON.stringify(file.redirects, null, 2);
  const wwwHost = JSON.stringify(`www.${domain}`);
  const apexOrigin = JSON.stringify(`https://${domain}`);

  return `
var REDIRECTS = ${redirectMapSource};

function handler(event) {
  var req = event.request;
  var host = req.headers.host && req.headers.host.value;
  var uri = req.uri;

  if (host === ${wwwHost}) {
    return {
      statusCode: 301,
      statusDescription: "Moved Permanently",
      headers: {
        location: { value: ${apexOrigin} + uri }
      }
    };
  }

  if (REDIRECTS[uri]) {
    return {
      statusCode: 301,
      statusDescription: "Moved Permanently",
      headers: {
        location: { value: REDIRECTS[uri] }
      }
    };
  }

  // Eleventy emits pretty URLs as <path>/index.html. CloudFront's
  // defaultRootObject only rewrites "/" → "/index.html", so map directory-
  // style requests onto their index file before the S3 origin sees them.
  if (uri.endsWith("/")) {
    req.uri = uri + "index.html";
  } else if (uri.lastIndexOf(".") < uri.lastIndexOf("/")) {
    req.uri = uri + "/index.html";
  }

  return req;
}
`.trim();
}
