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

  // Parse a human meeting time ("7:30pm", "8pm") into { hour, min } 24-hour
  // numbers. Returns null if it can't parse.
  const parseTime = (t) => {
    const m = String(t)
      .trim()
      .match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
    if (!m) return null;
    let hour = parseInt(m[1], 10);
    const min = parseInt(m[2] || "0", 10);
    const ap = (m[3] || "").toLowerCase();
    if (ap === "pm" && hour < 12) hour += 12;
    if (ap === "am" && hour === 12) hour = 0;
    return { hour, min };
  };

  // Parse a human meeting time ("7:30pm", "8pm") into 24-hour "HH:MM" for
  // schema.org Event times. Returns the input unchanged if it can't parse.
  eleventyConfig.addFilter("time24", (t) => {
    const parsed = parseTime(t);
    if (!parsed) return t;
    return `${String(parsed.hour).padStart(2, "0")}:${String(parsed.min).padStart(2, "0")}`;
  });

  // Event date helpers. Our recurring events (the weekly jam, the monthly gig)
  // are described with schema.org `eventSchedule`, but Google's Event rich
  // results ignore eventSchedule and require a literal `startDate` (and
  // recommend `endDate`). These helpers compute the *next* occurrence's
  // wall-clock start/end as ISO 8601 strings carrying the correct
  // Europe/London offset (BST vs GMT), so the markup stays valid year-round
  // and refreshes on every rebuild.
  const LONDON_TZ = "Europe/London";
  const WEEKDAYS = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };

  // Current Europe/London wall clock as plain { y, mo, d, h, mi } numbers
  // (mo is 1-based). Lets us reason in local time regardless of server TZ.
  const londonNow = () => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: LONDON_TZ,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
        .formatToParts(new Date())
        .map((p) => [p.type, p.value]),
    );
    return {
      y: +parts.year,
      mo: +parts.month,
      d: +parts.day,
      h: +(parts.hour === "24" ? "0" : parts.hour),
      mi: +parts.minute,
    };
  };

  // The Europe/London UTC offset ("+01:00" / "+00:00") in effect on a given
  // local date, sampled at noon to stay clear of the DST switch hours.
  const londonOffset = (y, mo, d) => {
    const sample = new Date(Date.UTC(y, mo - 1, d, 12));
    const name =
      new Intl.DateTimeFormat("en-GB", { timeZone: LONDON_TZ, timeZoneName: "longOffset" })
        .formatToParts(sample)
        .find((p) => p.type === "timeZoneName")?.value || "GMT";
    const m = name.match(/([+-]\d{2}:\d{2})/);
    return m ? m[1] : "+00:00";
  };

  // Format wall-clock numbers as an ISO 8601 string with the London offset.
  const toIsoLondon = (y, mo, d, h, mi) => {
    const p = (n) => String(n).padStart(2, "0");
    return `${y}-${p(mo)}-${p(d)}T${p(h)}:${p(mi)}:00${londonOffset(y, mo, d)}`;
  };

  // Build { start, end } ISO strings from local wall-clock start numbers and a
  // duration in hours, rolling end over to the following day if needed.
  const occurrence = (y, mo, d, h, mi, durationHours) => {
    const start = new Date(Date.UTC(y, mo - 1, d, h, mi));
    const end = new Date(start.getTime() + durationHours * 3600 * 1000);
    return {
      start: toIsoLondon(y, mo, d, h, mi),
      end: toIsoLondon(
        end.getUTCFullYear(),
        end.getUTCMonth() + 1,
        end.getUTCDate(),
        end.getUTCHours(),
        end.getUTCMinutes(),
      ),
    };
  };

  // Next occurrence of a weekly event (e.g. "Wednesday" at "7:30pm"). If today
  // is the day but the start time has already passed, rolls to next week.
  eleventyConfig.addFilter("nextWeekly", (time, weekday, durationHours = 3) => {
    const target = WEEKDAYS[String(weekday).toLowerCase()];
    const t = parseTime(time);
    if (target === undefined || !t) return null;
    const now = londonNow();
    const base = new Date(Date.UTC(now.y, now.mo - 1, now.d));
    let add = (target - base.getUTCDay() + 7) % 7;
    if (add === 0 && (now.h > t.hour || (now.h === t.hour && now.mi >= t.min))) add = 7;
    const day = new Date(Date.UTC(now.y, now.mo - 1, now.d + add));
    return occurrence(
      day.getUTCFullYear(),
      day.getUTCMonth() + 1,
      day.getUTCDate(),
      t.hour,
      t.min,
      durationHours,
    );
  });

  // Day-of-month for the nth weekday of a month (mo 1-based, weekday 0-6).
  const nthWeekday = (y, mo, weekday, n) => {
    const first = new Date(Date.UTC(y, mo - 1, 1)).getUTCDay();
    return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
  };

  // Next occurrence of a monthly event (e.g. the 3rd "Saturday" at "8:30pm").
  // Rolls to next month once this month's instance has passed.
  eleventyConfig.addFilter("nextMonthly", (time, weekday, week, durationHours = 3) => {
    const target = WEEKDAYS[String(weekday).toLowerCase()];
    const t = parseTime(time);
    if (target === undefined || !t) return null;
    const now = londonNow();
    let y = now.y;
    let mo = now.mo;
    let d = nthWeekday(y, mo, target, week);
    const passed =
      d < now.d || (d === now.d && (now.h > t.hour || (now.h === t.hour && now.mi >= t.min)));
    if (passed) {
      mo += 1;
      if (mo > 12) {
        mo = 1;
        y += 1;
      }
      d = nthWeekday(y, mo, target, week);
    }
    return occurrence(y, mo, d, t.hour, t.min, durationHours);
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
