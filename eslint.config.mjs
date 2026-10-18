// @ts-check
import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import composurecdk from "@composurecdk/eslint-plugin";

export default defineConfig(
  { ignores: ["**/dist/", "**/node_modules/", "**/cdk.out/", "gallery-staging/"] },
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            "eslint.config.mjs",
            "packages/site/eleventy.config.js",
            "packages/cdk/scripts/*.mjs",
            "packages/site/scripts/*.mjs",
          ],
        },
      },
    },
  },
  {
    files: [
      "eslint.config.mjs",
      "packages/site/**/*.{js,mjs,cjs}",
      "packages/cdk/scripts/*.mjs",
      "packages/site/scripts/*.mjs",
    ],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ["packages/cdk/scripts/*.mjs", "packages/site/scripts/*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        fetch: "readonly",
        URL: "readonly",
        AbortSignal: "readonly",
      },
    },
  },
  // composureCDK's builder/Lifecycle invariants, on app source only (they flag
  // tests and config). An application takes `recommended` alone; the other
  // tiers guard hazards of publishing a package.
  {
    files: ["packages/cdk/src/**/*.ts"],
    extends: [composurecdk.configs.recommended],
    rules: {
      "composurecdk/no-realm-bound-instanceof": [
        "error",
        { assumeNeverInstalledAsADependency: true },
      ],
    },
  },
  eslintConfigPrettier,
);
