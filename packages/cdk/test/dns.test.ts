import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { beforeAll, describe, expect, it } from "vitest";
import { compose, ref } from "@composurecdk/core";
import { createHostedZoneBuilder, type HostedZoneBuilderResult } from "@composurecdk/route53";
import { zoneRecords } from "@composurecdk/route53/zone";
import { DOMAIN, ZONE_RECORDS } from "../src/zone-records.js";

/**
 * Synthesises just the DNS portion of the composed system in a throwaway
 * stack. Isolates zone + records from the full {@link createSystem}, which
 * also needs a site-content directory and three stacks wired for cross-region
 * references.
 */
function synthTemplate(): Template {
  const app = new App();
  const stack = new Stack(app, "TestDns");
  compose(
    {
      zone: createHostedZoneBuilder().zoneName(DOMAIN),
      records: zoneRecords(ZONE_RECORDS).zone(
        ref<HostedZoneBuilderResult>("zone").get("hostedZone"),
      ),
    },
    { zone: [], records: ["zone"] },
  ).build(stack, "DNS");
  return Template.fromStack(stack);
}

describe("dns composition", () => {
  let template: Template;

  beforeAll(() => {
    template = synthTemplate();
  });

  describe("resource counts", () => {
    it("creates exactly one hosted zone", () => {
      template.resourceCountIs("AWS::Route53::HostedZone", 1);
    });

    it("creates 16 record sets (8 A, 4 CNAME, 3 TXT, 1 MX)", () => {
      template.resourceCountIs("AWS::Route53::RecordSet", 16);
    });
  });

  describe("hosted zone", () => {
    it("uses the ukehoot.net domain", () => {
      template.hasResourceProperties("AWS::Route53::HostedZone", {
        Name: "ukehoot.net.",
      });
    });
  });

  describe("A records", () => {
    it.each([
      ["ukehoot.net.", "88.208.252.9"],
      ["www.ukehoot.net.", "88.208.252.9"],
      ["mail.ukehoot.net.", "213.171.216.40"],
      ["webmail.ukehoot.net.", "213.171.216.231"],
      ["smtp.ukehoot.net.", "213.171.216.50"],
      ["exchange.ukehoot.net.", "213.171.192.50"],
      ["mailserver.ukehoot.net.", "213.171.216.40"],
      ["mcp.ukehoot.net.", "213.171.195.10"],
    ])("%s → %s", (name, ip) => {
      template.hasResourceProperties("AWS::Route53::RecordSet", {
        Type: "A",
        Name: name,
        ResourceRecords: [ip],
      });
    });
  });

  describe("CNAME records (Livemail DKIM)", () => {
    it.each([1, 2, 3, 4])("livemail%d._domainkey points to its DKIM target", (n) => {
      template.hasResourceProperties("AWS::Route53::RecordSet", {
        Type: "CNAME",
        Name: `livemail${String(n)}._domainkey.ukehoot.net.`,
        ResourceRecords: [`livemail${String(n)}._domainkey.39769.dkim.livemail.co.uk.`],
      });
    });
  });

  describe("TXT records", () => {
    it("apex TXT carries both the MS verification token and SPF policy", () => {
      template.hasResourceProperties("AWS::Route53::RecordSet", {
        Type: "TXT",
        Name: "ukehoot.net.",
        ResourceRecords: ['"MS=ms66482160"', '"v=spf1 mx a include:_spf.livemail.co.uk ~all"'],
      });
    });

    it("_dmarc TXT publishes a monitor-only DMARC policy", () => {
      template.hasResourceProperties("AWS::Route53::RecordSet", {
        Type: "TXT",
        Name: "_dmarc.ukehoot.net.",
        ResourceRecords: ['"v=DMARC1; p=none;"'],
      });
    });

    it("dzc.nuget TXT carries the NuGet domain-association token", () => {
      template.hasResourceProperties("AWS::Route53::RecordSet", {
        Type: "TXT",
        Name: "dzc.nuget.ukehoot.net.",
        ResourceRecords: ['"K2G6Wa8y"'],
      });
    });
  });

  describe("MX record", () => {
    it("apex MX routes mail to mailserver.livemail.co.uk with priority 10", () => {
      template.hasResourceProperties("AWS::Route53::RecordSet", {
        Type: "MX",
        Name: "ukehoot.net.",
        ResourceRecords: ["10 mailserver.livemail.co.uk."],
      });
    });
  });

  describe("template", () => {
    it("matches the expected synthesised template", () => {
      expect(template.toJSON()).toMatchSnapshot();
    });
  });
});
