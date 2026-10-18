/**
 * This is intended to be a basic starting point for linting in your app.
 * It relies on recommended configs out of the box for simplicity, but you can
 * and should modify this configuration to best suit your team's needs.
 */

/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    ecmaFeatures: {
      jsx: true,
    },
  },
  env: {
    browser: true,
    commonjs: true,
    es6: true,
  },
  ignorePatterns: ["!**/.server", "!**/.client"],

  // Base config
  extends: ["eslint:recommended"],
  rules: {
    "import/default": "warn",
    "import/namespace": "warn",
    "no-constant-condition": "warn",
    "no-useless-escape": "warn",
  },

  overrides: [
    // React
    {
      files: ["**/*.{js,jsx,ts,tsx}"],
      plugins: ["react", "jsx-a11y"],
      extends: [
        "plugin:react/recommended",
        "plugin:react/jsx-runtime",
        "plugin:react-hooks/recommended",
        "plugin:jsx-a11y/recommended",
      ],
      settings: {
        react: {
          version: "detect",
        },
        formComponents: ["Form"],
        linkComponents: [
          { name: "Link", linkAttribute: "to" },
          { name: "NavLink", linkAttribute: "to" },
        ],
        "import/resolver": {
          typescript: {},
        },
      },
      rules: {
        "react/prop-types": 0,
        "react/no-unescaped-entities": "warn",
        "react-hooks/immutability": "warn",
        "react-hooks/set-state-in-effect": "warn",
        "jsx-a11y/no-autofocus": "warn",
        "import/default": "warn",
        "import/namespace": "warn",
      },
    },

    // Typescript
    {
      files: ["**/*.{ts,tsx}"],
      plugins: ["@typescript-eslint", "import"],
      parser: "@typescript-eslint/parser",
      settings: {
        "import/internal-regex": "^~/",
        "import/resolver": {
          node: {
            extensions: [".ts", ".tsx"],
          },
          typescript: {
            alwaysTryTypes: true,
          },
        },
      },
      extends: [
        "plugin:@typescript-eslint/recommended",
        "plugin:import/recommended",
        "plugin:import/typescript",
      ],
      rules: {
        "@typescript-eslint/no-explicit-any": "warn",
        "@typescript-eslint/no-unused-vars": "warn",
        "import/default": "warn",
        "import/namespace": "warn"
      }
    },

    // Node
    {
      files: [".eslintrc.cjs"],
      env: {
        node: true,
      },
    },

    // Playwright: fixtures receive a `use` callback that is not a React hook.
    {
      files: ["e2e/**/*.ts", "playwright.config.ts"],
      env: {
        node: true,
      },
      rules: {
        "react-hooks/rules-of-hooks": "off",
        "no-empty-pattern": "off",
      },
    },
    {
      files: ["e2e/**/*.spec.ts"],
      plugins: ["playwright"],
      extends: ["plugin:playwright/recommended"],
      rules: {
        "playwright/no-wait-for-timeout": "error",
        "playwright/no-networkidle": "error",
        "playwright/prefer-web-first-assertions": "error",
        "playwright/no-element-handle": "error",
        "playwright/no-eval": "error",
        "playwright/no-focused-test": "error",
        "playwright/prefer-native-locators": "error",
        "playwright/no-raw-locators": "warn",
        "no-restricted-imports": [
          "error",
          {
            paths: [
              {
                name: "@playwright/test",
                importNames: ["test", "expect"],
                message:
                  "Import { test, expect } from './support/test' instead so persona and diagnostic fixtures are active.",
              },
            ],
          },
        ],
      },
    },
  ],
};
