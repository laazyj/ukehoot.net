#!/usr/bin/env node
// One-shot Tumblr → Eleventy importer for ukehoot.tumblr.com.
//
// Pulls every post via the keyless Tumblr v1 XML API (api/read), converts
// each one to a markdown file under content/posts/<YYYY>/<YYYY-MM-DD>-<slug>/
// with media files alongside, and writes the matching redirect map to
// packages/cdk/redirects.json so CloudFront can 301 old Tumblr URLs to
// their new home.
//
// Usage:
//   npm run import           # full import (downloads media)
//   npm run import:dry       # fetches metadata, prints summary, no writes
//
// Idempotent: existing files are not overwritten on a rerun.

import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { XMLParser } from "fast-xml-parser";
import TurndownService from "turndown";

const TUMBLR_HOST = "ukehoot.tumblr.com";
const PAGE_SIZE = 50;
const DOWNLOAD_CONCURRENCY = 6;
const here = dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = resolve(here, "..");
const REPO_ROOT = resolve(SITE_ROOT, "..", "..");
const POSTS_DIR = join(SITE_ROOT, "content", "posts");
const REDIRECTS_FILE = join(REPO_ROOT, "packages", "cdk", "redirects.json");

const DRY = process.argv.includes("--dry");

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  // photo-url repeats — keep them as an array even when there's just one.
  isArray: (name) => ["photo-url", "video-player", "post"].includes(name),
});

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  emDelimiter: "_",
});
// Tumblr puts <br/> in many posts; preserve as Markdown line breaks.
turndown.addRule("lineBreak", {
  filter: "br",
  replacement: () => "  \n",
});

async function fetchPage(start) {
  const url = `https://${TUMBLR_HOST}/api/read?num=${PAGE_SIZE}&start=${start}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Tumblr API error: ${res.status} on ${url}`);
  return await res.text();
}

function parsePage(xml) {
  const parsed = xmlParser.parse(xml);
  const tumblr = parsed.tumblr;
  const total = Number(tumblr.posts["@_total"]);
  const posts = tumblr.posts.post ?? [];
  return { total, posts };
}

async function fetchAllPosts() {
  process.stdout.write("Fetching posts: ");
  const first = await fetchPage(0);
  const { total, posts: firstPosts } = parsePage(first);
  process.stdout.write(`${firstPosts.length}`);

  const all = [...firstPosts];
  let start = PAGE_SIZE;
  while (start < total) {
    const xml = await fetchPage(start);
    const { posts } = parsePage(xml);
    all.push(...posts);
    process.stdout.write(`+${posts.length}`);
    start += PAGE_SIZE;
  }
  process.stdout.write(` = ${all.length} of ${total}\n`);
  return all;
}

function postSlug(post) {
  const fromAttr = String(post["@_slug"] ?? "").trim();
  if (fromAttr) return fromAttr;
  const url = String(post["@_url-with-slug"] ?? "");
  const m = /\/post\/\d+\/([^/?#]+)/.exec(url);
  if (m) return m[1];
  return `post-${String(post["@_id"])}`;
}

function postDate(post) {
  // unix-timestamp is seconds. date-gmt is also reliable. Prefer unix.
  const ts = Number(post["@_unix-timestamp"]);
  return new Date(ts * 1000);
}

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

function htmlToMarkdown(html) {
  if (!html) return "";
  // The XML decoder already turned &lt;p&gt; into <p>; pass to turndown.
  const md = turndown.turndown(String(html)).trim();
  return md;
}

function escapeYaml(value) {
  if (value === null || value === undefined) return '""';
  const s = String(value);
  if (s === "") return '""';
  // Quote if contains anything fancy. Use double-quotes and escape backslashes/quotes.
  if (/[:#&*!|>'"%@`\n]/.test(s) || /^[?\-\s]/.test(s) || /\s$/.test(s)) {
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
  }
  return s;
}

function frontMatter(fields) {
  const lines = ["---"];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${escapeYaml(item)}`);
    } else if (typeof value === "object" && value instanceof Date) {
      lines.push(`${key}: ${value.toISOString()}`);
    } else {
      lines.push(`${key}: ${escapeYaml(value)}`);
    }
  }
  lines.push("---", "");
  return lines.join("\n");
}

function summaryFromHtml(html, max = 160) {
  if (!html) return "";
  const text = String(html)
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + "…";
}

function tagList(post) {
  const t = post.tag;
  if (!t) return [];
  return Array.isArray(t) ? t.map(String) : [String(t)];
}

function biggestPhoto(post) {
  const urls = post["photo-url"] ?? [];
  // photo-url is an array of { '#text': URL, '@_max-width': '1280' }
  const sorted = [...urls].sort((a, b) => Number(b["@_max-width"]) - Number(a["@_max-width"]));
  return sorted[0]?.["#text"];
}

function extOfUrl(url) {
  try {
    const u = new URL(url);
    const m = /\.([a-z0-9]+)$/i.exec(u.pathname);
    return m ? m[1].toLowerCase() : "bin";
  } catch {
    return "bin";
  }
}

async function fileExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function downloadTo(url, destPath) {
  if (await fileExists(destPath)) return { downloaded: false, bytes: 0 };
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
  await mkdir(dirname(destPath), { recursive: true });
  const length = Number(res.headers.get("content-length") ?? 0);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(destPath));
  return { downloaded: true, bytes: length };
}

async function pool(items, limit, fn) {
  const queue = [...items];
  let totalBytes = 0;
  let downloaded = 0;
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (item === undefined) return;
      const { downloaded: did, bytes } = await fn(item);
      if (did) {
        downloaded++;
        totalBytes += bytes;
        process.stdout.write(".");
      } else {
        process.stdout.write("·");
      }
    }
  });
  await Promise.all(workers);
  process.stdout.write("\n");
  return { downloaded, totalBytes };
}

function bytesHuman(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MiB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}

/**
 * Build the per-post bundle that the importer needs to write: directory,
 * markdown body, frontmatter, and download tasks.
 *
 * @param {object} post raw v1 XML post object
 */
function planPost(post) {
  const id = String(post["@_id"]);
  const slug = postSlug(post);
  const date = postDate(post);
  const dateYmd = ymd(date);
  const year = String(date.getFullYear());
  const dirSlug = `${dateYmd}-${slug}`;
  const dir = join(POSTS_DIR, year, dirSlug);
  const type = String(post["@_type"]).toLowerCase();
  const tags = tagList(post);
  const url = String(post["@_url"]);
  const urlWithSlug = String(post["@_url-with-slug"] ?? url);
  const oldUrlPath = new URL(url).pathname;
  const oldUrlPathWithSlug = new URL(urlWithSlug).pathname;
  const newUrlPath = `/posts/${year}/${dirSlug}/`;

  let title = "";
  let summary = "";
  let body = "";
  let postType;
  const photos = [];
  const downloads = [];
  let videoEmbed = null;
  let linkUrl = null;
  let linkText = null;
  let quote = null;
  let quoteSource = null;

  switch (type) {
    case "regular":
    case "submission": {
      postType = "text";
      title = String(post["regular-title"] ?? "").trim();
      const html = String(post["regular-body"] ?? "");
      body = htmlToMarkdown(html);
      summary = summaryFromHtml(html);
      break;
    }
    case "photo": {
      postType = "photo";
      const captionHtml = String(post["photo-caption"] ?? "");
      body = htmlToMarkdown(captionHtml);
      summary = summaryFromHtml(captionHtml);
      const photoUrl = biggestPhoto(post);
      if (photoUrl) {
        const ext = extOfUrl(photoUrl);
        const filename = `photo-1.${ext}`;
        photos.push(filename);
        downloads.push({ url: photoUrl, dest: join(dir, filename) });
      }
      break;
    }
    case "video": {
      // v1 Video posts are always external embeds (YouTube, Vimeo etc.) —
      // the source URL goes in the body alongside the embed iframe rather
      // than into `video:` frontmatter (which is reserved for hosted files).
      postType = "video";
      title = String(post["video-title"] ?? "").trim();
      const captionHtml = String(post["video-caption"] ?? "");
      body = htmlToMarkdown(captionHtml);
      summary = summaryFromHtml(captionHtml);
      const players = post["video-player"] ?? [];
      const sorted = [...players].sort(
        (a, b) => Number(b["@_max-width"] ?? 0) - Number(a["@_max-width"] ?? 0),
      );
      const player = sorted[0];
      if (player) videoEmbed = String(player["#text"] ?? "");
      break;
    }
    case "link": {
      postType = "link";
      linkText = String(post["link-text"] ?? "").trim();
      linkUrl = String(post["link-url"] ?? "").trim();
      title = linkText;
      const descHtml = String(post["link-description"] ?? "");
      body = htmlToMarkdown(descHtml);
      summary = summaryFromHtml(descHtml);
      break;
    }
    case "quote": {
      postType = "quote";
      quote = String(post["quote-text"] ?? "").trim();
      quoteSource = String(post["quote-source"] ?? "").trim() || null;
      summary = summaryFromHtml(quote);
      break;
    }
    default: {
      postType = "text";
      body = `<!-- Unsupported Tumblr post type: ${type} -->`;
      break;
    }
  }

  const fm = frontMatter({
    title,
    date,
    summary,
    originalUrl: urlWithSlug,
    originalId: id,
    postType,
    photos,
    videoEmbed,
    linkUrl,
    linkText,
    quote,
    quoteSource,
    tags,
  });

  // Inline the video iframe into the body (markdown-it allows raw HTML).
  let bodyOut = body;
  if (videoEmbed && !bodyOut.includes("<iframe")) {
    bodyOut = `<div class="video-embed">${videoEmbed}</div>\n\n${bodyOut}`;
  }

  return {
    id,
    dir,
    indexPath: join(dir, "index.md"),
    contents: fm + bodyOut.trim() + "\n",
    downloads,
    redirectMap: {
      [oldUrlPath]: newUrlPath,
      ...(oldUrlPathWithSlug !== oldUrlPath ? { [oldUrlPathWithSlug]: newUrlPath } : {}),
    },
    summary: { type: postType, year, dateYmd, slug, title: title || summary || "(untitled)" },
  };
}

async function main() {
  const posts = await fetchAllPosts();
  const plans = posts.map(planPost);

  // Some posts share a date+slug (announcements re-posted same day). Append
  // the post id to the dir/URL only when needed so most URLs stay clean.
  const dirCounts = new Map();
  for (const p of plans) dirCounts.set(p.dir, (dirCounts.get(p.dir) ?? 0) + 1);
  for (const p of plans) {
    if (dirCounts.get(p.dir) > 1) {
      const newDir = `${p.dir}-${p.id}`;
      const newUrlPath = `/posts/${p.summary.year}/${p.dir.split("/").pop()}-${p.id}/`;
      // Rewrite redirect targets to point at the disambiguated path.
      for (const oldPath of Object.keys(p.redirectMap)) p.redirectMap[oldPath] = newUrlPath;
      p.dir = newDir;
      p.indexPath = join(newDir, "index.md");
      // Rebase any media downloads queued under the old dir.
      for (const d of p.downloads) d.dest = join(newDir, d.dest.split("/").pop());
    }
  }

  // Summarise.
  const byType = new Map();
  const byYear = new Map();
  let totalDownloads = 0;
  for (const p of plans) {
    byType.set(p.summary.type, (byType.get(p.summary.type) ?? 0) + 1);
    byYear.set(p.summary.year, (byYear.get(p.summary.year) ?? 0) + 1);
    totalDownloads += p.downloads.length;
  }
  console.log(`\nPosts: ${plans.length}`);
  console.log("By type:");
  for (const [t, n] of [...byType.entries()].sort()) console.log(`  ${t}: ${n}`);
  console.log("By year:");
  for (const [y, n] of [...byYear.entries()].sort()) console.log(`  ${y}: ${n}`);
  console.log(`Media downloads queued: ${totalDownloads}`);

  if (DRY) {
    console.log("\n--dry: stopping before any writes.");
    return;
  }

  // Write markdown files. Skip if already exists (idempotent).
  let written = 0;
  let skipped = 0;
  for (const p of plans) {
    if (await fileExists(p.indexPath)) {
      skipped++;
      continue;
    }
    await mkdir(p.dir, { recursive: true });
    await writeFile(p.indexPath, p.contents, "utf8");
    written++;
  }
  console.log(`\nMarkdown: ${written} written, ${skipped} skipped (already present).`);

  // Download media in parallel.
  const allDownloads = plans.flatMap((p) => p.downloads);
  if (allDownloads.length > 0) {
    console.log(`Media: downloading ${allDownloads.length} files (· skip / . new) …`);
    const { downloaded, totalBytes } = await pool(
      allDownloads,
      DOWNLOAD_CONCURRENCY,
      async ({ url, dest }) => downloadTo(url, dest),
    );
    console.log(`Media: ${downloaded} new (${bytesHuman(totalBytes)}).`);
  }

  // Build & write redirects.json.
  const allRedirects = {};
  for (const p of plans) Object.assign(allRedirects, p.redirectMap);
  const sortedRedirects = Object.fromEntries(
    Object.entries(allRedirects).sort(([a], [b]) => a.localeCompare(b)),
  );
  const existingFile = JSON.parse(await readFile(REDIRECTS_FILE, "utf8"));
  const newFile = { ...existingFile, redirects: sortedRedirects };
  await writeFile(REDIRECTS_FILE, JSON.stringify(newFile, null, 2) + "\n", "utf8");
  console.log(
    `Redirects: wrote ${Object.keys(sortedRedirects).length} entries to ${REDIRECTS_FILE}`,
  );
}

await main();
