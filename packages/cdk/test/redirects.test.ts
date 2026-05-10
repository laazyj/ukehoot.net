import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { validateRedirects } from "../src/redirects.js";

interface RedirectsFile {
  redirects: unknown;
}

describe("validateRedirects", () => {
  it("accepts the canonical redirects.json shipped in this repo", () => {
    const path = resolve(import.meta.dirname, "..", "redirects.json");
    const file = JSON.parse(readFileSync(path, "utf8")) as RedirectsFile;
    expect(() => validateRedirects(file.redirects)).not.toThrow();
  });

  it("rejects a non-object", () => {
    expect(() => validateRedirects("nope")).toThrow(/must be an object/);
    expect(() => validateRedirects(null)).toThrow(/must be an object/);
    expect(() => validateRedirects([])).toThrow(/must be an object/);
  });

  it("rejects keys that don't start with /", () => {
    expect(() => validateRedirects({ "post/foo": "/tech/foo/" })).toThrow(/must start with "\/"/);
  });

  it("rejects non-string or empty values", () => {
    expect(() => validateRedirects({ "/old": 42 })).toThrow(/non-empty string/);
    expect(() => validateRedirects({ "/old": "" })).toThrow(/non-empty string/);
  });

  it("rejects self-redirects", () => {
    expect(() => validateRedirects({ "/loop": "/loop" })).toThrow(/redirects to itself/);
  });

  it("rejects two-hop chains", () => {
    expect(() =>
      validateRedirects({
        "/a": "/b",
        "/b": "/c",
      }),
    ).toThrow(/two-hop chain/);
  });

  it("returns a plain map for valid input", () => {
    const out = validateRedirects({
      "/post/old-1": "/tech/new-1/",
      "/post/old-2": "/music/new-2/",
    });
    expect(out).toEqual({
      "/post/old-1": "/tech/new-1/",
      "/post/old-2": "/music/new-2/",
    });
  });
});
