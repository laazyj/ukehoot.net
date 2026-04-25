import { App, Stack } from "aws-cdk-lib";
import { resolve } from "node:path";

import { createSystem } from "./system.js";

const PRIMARY_REGION = "eu-west-2";
// ACM certificates attached to CloudFront must live in us-east-1.
const CLOUDFRONT_CERT_REGION = "us-east-1";

const app = new App();

// Both ends of a cross-region ref must opt in, so every stack sets the flag.
const stackProps = (region: string) => ({
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region },
  crossRegionReferences: true,
});

const dnsStack = new Stack(app, "UkehootNetDnsStack", {
  ...stackProps(PRIMARY_REGION),
  description: "DNS for ukehoot.net (Route 53 hosted zone + records).",
});

// Dedicated topic stack so it has no downstream deps and every us-east-1
// stack (cert, cdnAlarms, future) can target the same topic without cycles.
const usEast1AlertsStack = new Stack(app, "UkehootNetUsEast1AlertsStack", {
  ...stackProps(CLOUDFRONT_CERT_REGION),
  description: "Notification topic for us-east-1 alarms (cert + CloudFront).",
});

const certStack = new Stack(app, "UkehootNetCertStack", {
  ...stackProps(CLOUDFRONT_CERT_REGION),
  description: "ACM certificate for ukehoot.net.",
});

const siteStack = new Stack(app, "UkehootNetSiteStack", {
  ...stackProps(PRIMARY_REGION),
  description: "ukehoot.net — static site on CloudFront + S3.",
});

// CloudFront metrics emit only in us-east-1; alarms must too. Kept separate
// from certStack to avoid a cdn↔cert cycle (cdnAlarms reads distribution id
// from siteStack, which depends on certStack).
const cdnAlarmsStack = new Stack(app, "UkehootNetCdnAlarmsStack", {
  ...stackProps(CLOUDFRONT_CERT_REGION),
  description: "CloudFront CloudWatch alarms (must live in us-east-1).",
});

const siteContentPath = resolve(import.meta.dirname, "..", "..", "site", "dist");

createSystem(
  { dnsStack, usEast1AlertsStack, certStack, siteStack, cdnAlarmsStack },
  siteContentPath,
).build(app, "App");

app.synth();
