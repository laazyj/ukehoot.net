---
layout: layouts/base.njk
title: "Privacy"
permalink: /privacy/
eleventyExcludeFromCollections: true
---

<article class="post">

# Privacy

Short version: we don't track you unless you say so, we don't run ads, and we
don't sell anything (we wouldn't know how).

## Analytics, only if you allow it

UkeHoot uses Google Analytics to see which pages people actually read. It's off
by default. Nothing is recorded until you choose **Accept** on the cookie
banner. Choose **Reject** (or press Escape) and no analytics cookies are set and
no analytics data is sent.

If you do accept, Google Analytics sets cookies and collects standard usage
data: the pages you visit, rough (city-level) location, and basic device and
browser information, with your IP address anonymised. We use it only to
understand what's worth keeping on the site.

The legal basis is your consent, under UK GDPR and PECR.

## Changing your mind

You can change your choice whenever you like, or clear this site's cookies in
your browser.

{% if analytics.measurementId %}

<p><button type="button" class="btn btn--ghost" data-consent-reopen>Reopen the cookie banner</button></p>
{% endif %}

## The technical bits

- Your choice is remembered in your browser under `ukehoot-consent-v1`. That's a
  local preference, not a tracker.
- The site is served through Amazon CloudFront and S3, which keep standard
  access logs (including IP addresses) for security and reliability.
- Web fonts are loaded from Google Fonts, so your browser fetches them from
  Google's servers.
- There is no advertising, no profiling, and no third-party tracking beyond the
  analytics described above.

## Photos

This site shows photographs from UkeHoot sessions over the years. If you appear
in one and would like it taken down, just email us and we will.

## Contact

Questions, or a takedown request? {% include "partials/email-link.njk" %}

</article>
