import { type App, type Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

const STACK_NAMES = [
  "UkehootNetDnsStack",
  "UkehootNetUsEast1AlertsStack",
  "UkehootNetCertStack",
  "UkehootNetSiteStack",
  "UkehootNetCdnAlarmsStack",
  "UkehootNetCiOidcStack",
] as const;

const stackTemplate = (app: App, name: (typeof STACK_NAMES)[number]) =>
  Template.fromStack(app.node.findChild(name) as Stack);

describe("app synthesis", () => {
  let app: App;
  let templates: Record<(typeof STACK_NAMES)[number], unknown>;

  beforeAll(() => {
    app = buildApp({
      account: "111111111111",
      siteContentPath: resolve(import.meta.dirname, "fixtures", "site"),
      alertEmail: "alerts@example.invalid",
    });
    templates = Object.fromEntries(
      STACK_NAMES.map((name) => [name, stackTemplate(app, name).toJSON()]),
    ) as typeof templates;
  });

  // One snapshot file per stack — keeps PR diffs scoped to the stacks that
  // actually changed instead of bundling all five into a single .snap file.
  // The template object is handed to the matcher directly so vitest's snapshot
  // serializer pipeline runs; CDK asset hashes are normalised to a stable
  // placeholder there (see vitest.setup.ts).
  it.each(STACK_NAMES)("%s matches snapshot", async (name) => {
    await expect(templates[name]).toMatchFileSnapshot(`./__snapshots__/${name}.snap`);
  });

  // Functional assertions sit alongside the snapshots for two reasons. (1) A
  // snapshot diff tells you "something changed" but not whether the change is
  // safe — the assertions below pin properties that *must* hold regardless of
  // refactors. (2) They also illustrate the kinds of checks worth writing
  // against composureCDK output beyond the synth snapshot.

  describe("ACM certificate", () => {
    it("covers apex and www", () => {
      stackTemplate(app, "UkehootNetCertStack").hasResourceProperties(
        "AWS::CertificateManager::Certificate",
        {
          DomainName: "ukehoot.net",
          SubjectAlternativeNames: ["www.ukehoot.net"],
        },
      );
    });
  });

  describe("budget", () => {
    it("limits monthly spend to 10 USD", () => {
      stackTemplate(app, "UkehootNetUsEast1AlertsStack").hasResourceProperties(
        "AWS::Budgets::Budget",
        {
          Budget: Match.objectLike({
            BudgetLimit: { Amount: 10, Unit: "USD" },
            BudgetType: "COST",
            TimeUnit: "MONTHLY",
          }),
        },
      );
    });
  });

  describe("CDN alarms", () => {
    // Recommended-alarm coverage from composureCDK — if this drops to zero,
    // someone has flipped `recommendedAlarms(false)` on the cdn builder.
    it("creates multiple CloudWatch alarms in the edge region", () => {
      const template = stackTemplate(app, "UkehootNetCdnAlarmsStack");
      const alarmCount = Object.keys(template.findResources("AWS::CloudWatch::Alarm")).length;
      expect(alarmCount).toBeGreaterThanOrEqual(5);
    });
  });

  describe("CI OIDC", () => {
    it("creates a deploy role scoped to the ukehoot.net repo", () => {
      const template = stackTemplate(app, "UkehootNetCiOidcStack");
      template.hasResourceProperties("AWS::IAM::Role", {
        RoleName: "GitHubActionsDeployRole",
      });
      // Subject claim must reference exactly this repo — forks/other repos
      // mint OIDC tokens under different `repo:<owner>/<name>:*` namespaces
      // and so cannot satisfy this StringLike condition.
      const policyDoc = JSON.stringify(template.findResources("AWS::IAM::Role"));
      expect(policyDoc).toContain("repo:laazyj/ukehoot.net:ref:refs/heads/main");
      expect(policyDoc).toContain("repo:laazyj/ukehoot.net:pull_request");
    });
  });
});
