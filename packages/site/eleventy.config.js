import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import rssPlugin from "@11ty/eleventy-plugin-rss";
// @ts-expect-error -- @11ty/eleventy-plugin-syntaxhighlight ships no type declarations (TS 7016)
import syntaxHighlight from "@11ty/eleventy-plugin-syntaxhighlight";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default function (eleventyConfig) {
  eleventyConfig.addPlugin(rssPlugin);
  eleventyConfig.addPlugin(syntaxHighlight);

  eleventyConfig.amendLibrary("md", (md) => {
    md.set({ typographer: true });
    md.enable(["replacements", "smartquotes"]);
  });

  eleventyConfig.addPassthroughCopy({ assets: "assets" });
  eleventyConfig.addPassthroughCopy({ static: "/" });
  // Media lives alongside each post under content/posts/<YYYY>/<slug>/. Pass
  // it through verbatim so post pages can reference photo-1.jpg etc. by
  // simple relative URL.
  eleventyConfig.addPassthroughCopy("content/posts/**/*.{jpg,jpeg,png,gif,mp4,webm,mp3}");

  eleventyConfig.addGlobalData("currentYear", () => new Date().getFullYear());
  eleventyConfig.addGlobalData("analytics", () => ({
    measurementId: process.env.GA_MEASUREMENT_ID || null,
  }));
  eleventyConfig.addGlobalData("build", () => ({
    sha: process.env.GITHUB_SHA || "dev",
  }));

  // Inline a file's contents verbatim. Used to ship the stylesheet inside
  // each page's <style> — one fewer HTTP request, instant first paint.
  eleventyConfig.addShortcode("inlineFile", (relPath) =>
    fs.readFileSync(path.join(__dirname, relPath), "utf8"),
  );

  // Convert a root-absolute path ("/assets/x.css") into a path relative to
  // the current page. Lets the site render under any URL prefix without a
  // build-time pathPrefix flag.
  eleventyConfig.addFilter("rel", function (target) {
    if (typeof target !== "string" || !target.startsWith("/")) return target;
    const pageUrl =
      (this.page && this.page.url) || (this.ctx && this.ctx.page && this.ctx.page.url) || "/";
    const depth = pageUrl.split("/").filter(Boolean).length;
    const prefix = depth === 0 ? "./" : "../".repeat(depth);
    return prefix + target.replace(/^\//, "");
  });

  const toDate = (date) => (date instanceof Date ? date : new Date(date));

  eleventyConfig.addFilter("readableDate", (date) =>
    toDate(date).toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" }),
  );

  eleventyConfig.addFilter("shortDate", (date) =>
    toDate(date).toLocaleDateString("en-GB", { month: "short", day: "numeric" }),
  );

  eleventyConfig.addFilter("htmlDateString", (date) => toDate(date).toISOString().slice(0, 10));

  eleventyConfig.addFilter("year", (date) => toDate(date).getFullYear());

  // First n items of an array. Used for the home-page photo teaser.
  eleventyConfig.addFilter("limit", (arr, n) => (Array.isArray(arr) ? arr.slice(0, n) : arr));

  // Drop falsy entries. Used to build the JSON-LD sameAs list from the
  // (optionally empty) social links in site.json.
  eleventyConfig.addFilter("compact", (arr) => (Array.isArray(arr) ? arr.filter(Boolean) : arr));

  // Site-credit helpers. site.json `team` is a list of people, each with a
  // `roles` list ("co-founder" | "builder" | "maintainer"). These drive the
  // machine-readable attribution (JSON-LD Person nodes, rel=author, humans.txt)
  // and are written to support more than one person without template changes.
  eleventyConfig.addFilter("withRole", (people, role) =>
    Array.isArray(people) ? people.filter((p) => (p.roles || []).includes(role)) : [],
  );
  // Map people to schema.org @id references for a graph property.
  eleventyConfig.addFilter("idRefs", (people) =>
    (Array.isArray(people) ? people : []).map((p) => ({ "@id": p.url })),
  );
  // A schema.org Person node for the @graph.
  eleventyConfig.addFilter("personNode", (p) => {
    const node = { "@type": "Person", "@id": p.url, name: p.name, url: p.url };
    if (p.sameAs && p.sameAs.length) node.sameAs = p.sameAs;
    return node;
  });

  // Base64-encode a string. Used to keep the contact email out of the page
  // source as scrapeable plaintext — the email-link partial ships the encoded
  // address and the decoder in base.njk turns it back into a mailto client-side.
  eleventyConfig.addFilter("base64", (s) => Buffer.from(String(s), "utf8").toString("base64"));

  // Parse a human meeting time ("7:30pm", "8pm") into 24-hour "HH:MM" for
  // schema.org Event times. Returns the input unchanged if it can't parse.
  eleventyConfig.addFilter("time24", (t) => {
    const m = String(t)
      .trim()
      .match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
    if (!m) return t;
    let hour = parseInt(m[1], 10);
    const min = m[2] || "00";
    const ap = (m[3] || "").toLowerCase();
    if (ap === "pm" && hour < 12) hour += 12;
    if (ap === "am" && hour === 12) hour = 0;
    return `${String(hour).padStart(2, "0")}:${min}`;
  });

  eleventyConfig.addFilter("readingTime", (input) => {
    if (!input) return 0;
    const text = String(input).replace(/<[^>]+>/g, " ");
    const words = text.split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.round(words / 225));
  });

  // Group a collection into [{ year, posts[] }] in reverse-chronological order.
  eleventyConfig.addFilter("byYear", (posts) => {
    const groups = new Map();
    for (const p of [...posts].reverse()) {
      const year = new Date(p.date).getFullYear();
      if (!groups.has(year)) groups.set(year, []);
      groups.get(year).push(p);
    }
    return [...groups.entries()].map(([year, posts]) => ({ year, posts }));
  });

  // Every published post tagged "post", oldest first. Drafts (those with
  // eleventyExcludeFromCollections) are dropped. Shared by all three
  // post-derived collections below.
  const publishedPosts = (api) =>
    api
      .getFilteredByTag("post")
      .filter((item) => !item.data.eleventyExcludeFromCollections)
      .sort((a, b) => a.date - b.date);

  // The whole-blog feed: every post, chronological. Year is derived from each
  // post's date — there is no per-year directory tag.
  eleventyConfig.addCollection("posts", publishedPosts);

  // A flat list of every photo across all posts, newest first. Drives the
  // self-hosted gallery page and the home-page photo teaser. `src` is the
  // post-relative media path; apply the `rel` filter at render time.
  eleventyConfig.addCollection("galleryPhotos", (api) => {
    const posts = [...publishedPosts(api)].reverse();
    const photos = [];
    for (const post of posts) {
      for (const photo of post.data.photos || []) {
        photos.push({
          src: post.url + photo,
          postUrl: post.url,
          title: post.data.title || post.data.summary || "",
          date: post.date,
        });
      }
    }
    return photos;
  });

  // [{ year, posts[] }], newest year first. Drives both the home page list
  // and the year-archive pagination.
  eleventyConfig.addCollection("postsByYear", (api) => {
    const posts = publishedPosts(api);
    const groups = new Map();
    for (const p of [...posts].reverse()) {
      const year = new Date(p.date).getFullYear();
      if (!groups.has(year)) groups.set(year, []);
      groups.get(year).push(p);
    }
    return [...groups.entries()].map(([year, posts]) => ({ year, posts }));
  });

  return {
    dir: {
      input: "content",
      output: "dist",
      includes: "../_includes",
      data: "../_data",
    },
    templateFormats: ["njk", "md", "html"],
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
  };
}
