import { CfnOutput, type Stack } from "aws-cdk-lib";
import { OpenIdConnectPrincipal, OpenIdConnectProvider } from "aws-cdk-lib/aws-iam";

import { createRoleBuilder, createStatementBuilder } from "@composurecdk/iam";

export interface CiOidcOptions {
  readonly githubOwner: string;
  readonly githubRepo: string;
  readonly cdkBootstrapQualifier?: string;
}

const GITHUB_OIDC_URL = "https://token.actions.githubusercontent.com";
const GITHUB_OIDC_AUDIENCE = "sts.amazonaws.com";
const DEFAULT_CDK_QUALIFIER = "hnb659fds";

export function addCiOidc(stack: Stack, options: CiOidcOptions): void {
  const qualifier = options.cdkBootstrapQualifier ?? DEFAULT_CDK_QUALIFIER;
  const repoSubject = `repo:${options.githubOwner}/${options.githubRepo}`;

  const provider = new OpenIdConnectProvider(stack, "GithubOidcProvider", {
    url: GITHUB_OIDC_URL,
    clientIds: [GITHUB_OIDC_AUDIENCE],
  });

  // Subject-claim allowlist scopes role assumption to this exact repo. Forks
  // run workflows under their own `repo:<fork>/<name>:*` namespace, so they
  // cannot mint a token that satisfies these conditions even though the OIDC
  // provider is account-wide.
  const principal = new OpenIdConnectPrincipal(provider, {
    StringEquals: {
      "token.actions.githubusercontent.com:aud": GITHUB_OIDC_AUDIENCE,
    },
    StringLike: {
      "token.actions.githubusercontent.com:sub": [
        `${repoSubject}:ref:refs/heads/main`,
        `${repoSubject}:pull_request`,
      ],
    },
  });

  // The role's only direct permission is to assume CDK's bootstrap roles in
  // any region of this account. Those roles are the actual permission boundary
  // for deploys; this design matches CDK's intended OIDC pattern and keeps the
  // long-lived role's blast radius limited to "do CDK things".
  const { role } = createRoleBuilder()
    .roleName("GitHubActionsDeployRole")
    .assumedBy(principal)
    .description(`GitHub Actions deploy role for ${options.githubOwner}/${options.githubRepo}.`)
    .addInlinePolicyStatements("AssumeCdkBootstrapRoles", [
      createStatementBuilder()
        .allow()
        .actions(["sts:AssumeRole"])
        .resources([
          `arn:aws:iam::*:role/cdk-${qualifier}-deploy-role-*`,
          `arn:aws:iam::*:role/cdk-${qualifier}-file-publishing-role-*`,
          `arn:aws:iam::*:role/cdk-${qualifier}-image-publishing-role-*`,
          `arn:aws:iam::*:role/cdk-${qualifier}-lookup-role-*`,
        ]),
    ])
    .build(stack, "GitHubActionsDeployRole");

  new CfnOutput(stack, "GitHubActionsDeployRoleArn", {
    value: role.roleArn,
    description: "Set as the GitHub Actions secret `AWS_DEPLOY_ROLE_ARN`.",
  });
}
