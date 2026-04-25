import { Duration, Fn, RemovalPolicy, type Stack } from "aws-cdk-lib";
import {
  FunctionCode,
  FunctionEventType,
  PriceClass,
  ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront";
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import { Source } from "aws-cdk-lib/aws-s3-deployment";

import { compose, ref } from "@composurecdk/core";
import { createCertificateBuilder, type CertificateBuilderResult } from "@composurecdk/acm";
import { alarmActionsPolicy } from "@composurecdk/cloudwatch";
import { createHostedZoneBuilder, type HostedZoneBuilderResult } from "@composurecdk/route53";
import { zoneRecords } from "@composurecdk/route53/zone";
import {
  createBucketBuilder,
  createBucketDeploymentBuilder,
  type BucketBuilderResult,
} from "@composurecdk/s3";
import {
  createCloudFrontAlarmBuilder,
  createDistributionBuilder,
  type DistributionBuilderResult,
} from "@composurecdk/cloudfront";
import { createTopicBuilder, type TopicBuilderResult } from "@composurecdk/sns";
import { outputs } from "@composurecdk/cloudformation";

import { buildRedirectFunctionCode } from "./redirect-function.js";
import { DOMAIN, WWW, ZONE_RECORDS } from "./zone-records.js";

export interface SystemStacks {
  /** Route 53 hosted zone + records. Region is cosmetic — Route 53 is global. */
  readonly dnsStack: Stack;
  /** SNS topic shared by every us-east-1 alarm. No downstream deps to avoid cycles. */
  readonly usEast1AlertsStack: Stack;
  /** ACM certificate. Must be `us-east-1` for CloudFront-attached certificates. */
  readonly certStack: Stack;
  /** S3 bucket, CloudFront distribution, bucket deployment, site-region alarms. */
  readonly siteStack: Stack;
  /** CloudFront CloudWatch alarms. Must be `us-east-1` (CloudFront metrics live there). */
  readonly cdnAlarmsStack: Stack;
}

const topicArnOutput = (refName: "usEast1Alerts" | "siteAlerts", role: string) => ({
  value: ref<TopicBuilderResult>(refName)
    .get("topic")
    .map((t) => t.topicArn),
  description: `Subscribe here to receive ${role}.`,
  scope: refName,
});

export function createSystem(stacks: SystemStacks, siteContentPath: string) {
  const { dnsStack, usEast1AlertsStack, certStack, siteStack, cdnAlarmsStack } = stacks;

  const hostedZone = ref<HostedZoneBuilderResult>("zone").get("hostedZone");
  const bucket = ref<BucketBuilderResult>("bucket").get("bucket");
  const distribution = ref<DistributionBuilderResult>("cdn").get("distribution");
  const certificate = ref<CertificateBuilderResult>("cert").get("certificate");

  return compose(
    {
      // DNS — apex/www A records still resolve to the existing host. The
      // CloudFront alias records are deliberately not yet created so this
      // stack can deploy without changing where end users land.
      zone: createHostedZoneBuilder().zoneName(DOMAIN),
      records: zoneRecords(ZONE_RECORDS).zone(hostedZone),

      // Cert (depends on zone for DNS validation)
      cert: createCertificateBuilder()
        .domainName(DOMAIN)
        .subjectAlternativeNames([WWW])
        .validationZone(hostedZone),

      // CloudWatch alarms can only target same-region SNS topics, so one topic per region.
      usEast1Alerts: createTopicBuilder().displayName("ukehoot.net us-east-1 alerts"),
      siteAlerts: createTopicBuilder().displayName("ukehoot.net site alerts"),

      // Site
      bucket: createBucketBuilder().accessLogging(true).removalPolicy(RemovalPolicy.RETAIN),
      cdn: createDistributionBuilder()
        .comment("ukehoot.net")
        .domainNames([DOMAIN, WWW])
        .certificate(certificate)
        .defaultRootObject("index.html")
        .priceClass(PriceClass.PRICE_CLASS_100)
        .origin(bucket.map((b) => S3BucketOrigin.withOriginAccessControl(b)))
        .defaultBehavior({
          viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          functions: [
            {
              eventType: FunctionEventType.VIEWER_REQUEST,
              functionName: `${siteStack.stackName}-redirect`,
              code: FunctionCode.fromInline(buildRedirectFunctionCode(DOMAIN)),
              comment: "www→apex 301 + old-URL redirect map",
            },
          ],
        })
        .errorResponses([
          {
            httpStatus: 403,
            responseHttpStatus: 404,
            responsePagePath: "/404.html",
            ttl: Duration.seconds(60),
          },
          {
            httpStatus: 404,
            responseHttpStatus: 404,
            responsePagePath: "/404.html",
            ttl: Duration.seconds(60),
          },
        ])
        // CloudFront metrics only emit in us-east-1; alarms must live there too.
        .recommendedAlarms(false),
      cdnAlarms: createCloudFrontAlarmBuilder().distribution(ref<DistributionBuilderResult>("cdn")),
      deploy: createBucketDeploymentBuilder()
        .sources([Source.asset(siteContentPath)])
        .destinationBucket(bucket)
        .distribution(distribution)
        .distributionPaths(["/*"])
        .prune(true),
    },
    {
      zone: [],
      records: ["zone"],
      cert: ["zone"],
      usEast1Alerts: [],
      siteAlerts: [],
      bucket: [],
      cdn: ["bucket", "cert"],
      cdnAlarms: ["cdn"],
      deploy: ["bucket", "cdn"],
    },
  )
    .withStacks({
      zone: dnsStack,
      records: dnsStack,
      cert: certStack,
      usEast1Alerts: usEast1AlertsStack,
      siteAlerts: siteStack,
      bucket: siteStack,
      cdn: siteStack,
      cdnAlarms: cdnAlarmsStack,
      deploy: siteStack,
    })
    .afterBuild(
      outputs({
        NameServers: {
          value: hostedZone.map((z) => Fn.join(",", z.hostedZoneNameServers ?? [])),
          description: "Set these as the NS records at the domain registrar to delegate the zone.",
          scope: "zone",
        },
        DistributionDomainName: {
          value: distribution.map((d) => d.distributionDomainName),
          description: "CloudFront distribution domain (for manual CNAME checks).",
          scope: "cdn",
        },
        SiteBucketName: {
          value: bucket.map((b) => b.bucketName),
          description: "S3 bucket backing the distribution.",
          scope: "bucket",
        },
        UsEast1AlertsTopicArn: topicArnOutput(
          "usEast1Alerts",
          "us-east-1 stack alarm notifications (cert + CloudFront)",
        ),
        SiteAlertsTopicArn: topicArnOutput("siteAlerts", "site-stack alarm notifications"),
      }),
    )
    .afterBuild((_scope, _id, results) => {
      const usEast1Action = new SnsAction(results.usEast1Alerts.topic);
      alarmActionsPolicy(usEast1AlertsStack, { defaults: { alarmActions: [usEast1Action] } });
      alarmActionsPolicy(certStack, { defaults: { alarmActions: [usEast1Action] } });
      alarmActionsPolicy(cdnAlarmsStack, { defaults: { alarmActions: [usEast1Action] } });
      alarmActionsPolicy(siteStack, {
        defaults: { alarmActions: [new SnsAction(results.siteAlerts.topic)] },
      });
    });
}
