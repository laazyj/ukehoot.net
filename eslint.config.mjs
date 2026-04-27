// @ts-check
import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier/flat";

export default defineConfig(
  { ignores: ["**/dist/", "**/node_modules/", "**/cdk.out/"] },
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
  eslintConfigPrettier,
);
