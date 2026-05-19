import { A, CNAME, MX, type RecordSpec, TXT } from "@composurecdk/route53/zone";

/**
 * Canonical record list for the zone. The records are subdomain prefixes
 * pointing at external services (mail provider, DKIM, verification tokens),
 * so none of them reference the apex domain itself — apex/`www` ALIAS
 * records to the CloudFront distribution are added in `system.ts`.
 *
 * Exported so tests can exercise zone composition without instantiating the
 * full multi-stack system (which requires a site-content directory for the
 * bucket deployment).
 */
export const ZONE_RECORDS: readonly RecordSpec[] = [
  // Service A records. Apex + www come from the site stack as ALIAS
  // records pointing at the CloudFront distribution.
  A("mail", "213.171.216.40"),
  A("webmail", "213.171.216.231"),
  A("smtp", "213.171.216.50"),
  A("exchange", "213.171.193.192"),
  A("mailserver", "213.171.216.40"),
  A("mcp", "213.171.195.10"),

  // Mail server (MX)
  MX("@", 10, "mailserver.livemail.co.uk."),

  // Livemail DKIM (CNAME) — Uke hOOt mailbox 144548
  CNAME("livemail1._domainkey", "livemail1._domainkey.144548.dkim.livemail.co.uk."),
  CNAME("livemail2._domainkey", "livemail2._domainkey.144548.dkim.livemail.co.uk."),
  CNAME("livemail3._domainkey", "livemail3._domainkey.144548.dkim.livemail.co.uk."),
  CNAME("livemail4._domainkey", "livemail4._domainkey.144548.dkim.livemail.co.uk."),

  // Mail policy (TXT)
  TXT("@", "v=spf1 mx a include:_spf.livemail.co.uk ~all"),
  TXT("_dmarc", "v=DMARC1; p=none;"),

  // Google Search Console
  TXT("@", "google-site-verification=hcs_zggEiOWUdPztat0_nNBcPq3NA0x3l9tQ2EQjz8I"),
];
