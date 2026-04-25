import { A, CNAME, MX, type RecordSpec, TXT } from "@composurecdk/route53/zone";

export const DOMAIN = "ukehoot.net";
export const WWW = `www.${DOMAIN}`;

/**
 * Canonical record list for the ukehoot.net zone. Exported so tests can
 * exercise the zone composition without instantiating the full multi-stack
 * system (which requires a site-content directory for the bucket deployment).
 *
 * TODO: confirm every record below with the registrar before deploying. The
 * current values are copied verbatim from jasonduffett.net as a placeholder
 * shape — IPs, MX/SPF/DKIM, and verification tokens will all need correcting
 * for ukehoot.net's actual hosting and mail setup.
 */
export const ZONE_RECORDS: readonly RecordSpec[] = [
  // Apex + service A records
  A("@", "88.208.252.9"),
  A("www", "88.208.252.9"),
  A("mail", "213.171.216.40"),
  A("webmail", "213.171.216.231"),
  A("smtp", "213.171.216.50"),
  A("exchange", "213.171.192.50"),
  A("mailserver", "213.171.216.40"),
  A("mcp", "213.171.195.10"),

  // Mail server (MX)
  MX("@", 10, "mailserver.livemail.co.uk."),

  // Livemail DKIM (CNAME)
  CNAME("livemail1._domainkey", "livemail1._domainkey.39769.dkim.livemail.co.uk."),
  CNAME("livemail2._domainkey", "livemail2._domainkey.39769.dkim.livemail.co.uk."),
  CNAME("livemail3._domainkey", "livemail3._domainkey.39769.dkim.livemail.co.uk."),
  CNAME("livemail4._domainkey", "livemail4._domainkey.39769.dkim.livemail.co.uk."),

  // Mail policy + verification (TXT)
  TXT("@", "MS=ms66482160"),
  TXT("@", "v=spf1 mx a include:_spf.livemail.co.uk ~all"),
  TXT("_dmarc", "v=DMARC1; p=none;"),
  TXT("dzc.nuget", "K2G6Wa8y"),
];
