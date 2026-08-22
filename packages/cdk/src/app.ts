import { App, Stack } from "aws-cdk-lib";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { templateTextPolicy } from "@composurecdk/cloudformation";

import { addCiOidc } from "./stacks/ci-oidc-stack.js";
import { createSystem } from "./system.js";

/**
 * Edit-points for forking this app to a different domain. Everything domain-
 * specific lives here; the rest of the code reads from the values passed
 * through `createSystem()`.
 *
 * `edgeRegion` is fixed to `us-east-1` because that's where ACM certificates
 * attached to CloudFront must live and where CloudFront/Route 53 metrics
 * emit. `primaryRegion` is otherwise free.
 */
const CONFIG = {
  domain: "ukehoot.net",
  primaryRegion: "eu-west-2",
  edgeRegion: "us-east-1",
} as const;

export interface BuildAppOptions {
  /** AWS account ID. `undefined` produces an env-agnostic synth (cdk's default). */
  readonly account: string | undefined;
  /** Directory whose contents are uploaded to the site bucket. */
  readonly siteContentPath: string;
  /** Email address subscribed to both alarm topics. */
  readonly alertEmail: string;
}

/**
 * Constructs the App + stacks but does not call `synth()`. Tests import this
 * to snapshot the same wiring CDK actually deploys.
 */
export function buildApp({ account, siteContentPath, alertEmail }: BuildAppOptions): App {
  const app = new App();

  // CloudFormation cannot store non-ASCII template text and rewrites it on
  // deploy, leaving `cdk diff` permanently dirty. `throw` rather than
  // `sanitize`: fixing the source beats papering over it, and the estate is
  // small. `fields` adds the CloudFront resources the package's seed registry
  // omits. See "Template text is ASCII only" in the README for the coverage
  // gaps this cannot reach.
  templateTextPolicy(app, {
    fields: {
      "AWS::CloudFront::Function": ["functionCode"],
      "AWS::CloudFront::KeyValueStore": ["comment"],
    },
  });

  // Both ends of a cross-region ref must opt in, so every stack sets the flag.
  const stackProps = (region: string) => ({
    env: { account, region },
    crossRegionReferences: true,
  });

  const dnsStack = new Stack(app, "UkehootNetDnsStack", {
    ...stackProps(CONFIG.primaryRegion),
    description: `DNS for ${CONFIG.domain} (Route 53 hosted zone + records).`,
  });

  // Dedicated topic stack so it has no downstream deps and every us-east-1
  // stack (cert, cdnAlarms, future) can target the same topic without cycles.
  const usEast1AlertsStack = new Stack(app, "UkehootNetUsEast1AlertsStack", {
    ...stackProps(CONFIG.edgeRegion),
    description: "Notification topic for us-east-1 alarms (cert + CloudFront).",
  });

  const certStack = new Stack(app, "UkehootNetCertStack", {
    ...stackProps(CONFIG.edgeRegion),
    description: `ACM certificate for ${CONFIG.domain}.`,
  });

  const siteStack = new Stack(app, "UkehootNetSiteStack", {
    ...stackProps(CONFIG.primaryRegion),
    description: `Static site for ${CONFIG.domain} (CloudFront + S3).`,
  });

  // Kept separate from certStack to avoid a cdn↔cert cycle (this stack reads
  // distribution id from siteStack, which depends on certStack). Logical id
  // retains the "CdnAlarms" name so the deployed stack isn't replaced.
  const cdnAlarmsStack = new Stack(app, "UkehootNetCdnAlarmsStack", {
    ...stackProps(CONFIG.edgeRegion),
    description: "CloudWatch alarms for site metrics that AWS only emits in us-east-1.",
  });

  // Standalone — bootstrapped once from a workstation, then GitHub Actions
  // assumes the role for all subsequent deploys. No wiring through createSystem.
  const ciOidcStack = new Stack(app, "UkehootNetCiOidcStack", {
    ...stackProps(CONFIG.primaryRegion),
    description: "GitHub Actions OIDC provider + deploy role for laazyj/ukehoot.net.",
  });
  addCiOidc(ciOidcStack, { githubOwner: "laazyj", githubRepo: "ukehoot.net" });

  createSystem(
    { dnsStack, usEast1AlertsStack, certStack, siteStack, cdnAlarmsStack },
    { domain: CONFIG.domain, siteContentPath, alertEmail },
  ).build(app, CONFIG.domain);

  return app;
}

// Synth only when invoked as the cdk app entry. Importing from tests doesn't
// trigger synth — keeps the wiring in one file without side-effecting on import.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const alertEmail = process.env.ALERT_EMAIL;
  if (!alertEmail) {
    throw new Error("ALERT_EMAIL is required, e.g. `export ALERT_EMAIL=you@example.com`.");
  }
  buildApp({
    account: process.env.CDK_DEFAULT_ACCOUNT,
    siteContentPath: resolve(import.meta.dirname, "..", "..", "site", "dist"),
    alertEmail,
  }).synth();
}
