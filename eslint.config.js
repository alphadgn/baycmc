import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

// Pattern that matches any module path ending in `.server` or `.server.<ext>`,
// e.g. "@/integrations/supabase/client.server", "../foo.server.ts",
// "./bar.server". Catches both bare and extension-suffixed imports.
const SERVER_ONLY_IMPORT_REGEX = String.raw`(^|/)[^/]+\.server(\.[a-zA-Z]+)?$`;

const SERVER_IMPORT_RULE = [
  "error",
  {
    patterns: [
      {
        regex: SERVER_ONLY_IMPORT_REGEX,
        message:
          "Server-only modules (*.server.ts) must not be imported from client/shared code. " +
          "Wrap the logic in createServerFn (in a *.functions.ts file) and import that instead.",
      },
    ],
  },
];

export default tseslint.config(
  { ignores: ["dist", ".output", ".vinxi"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      // Block client/shared modules from importing *.server.ts files.
      // Vite's import-protection plugin catches this at build time too, but
      // ESLint surfaces it during editing so issues never reach the build.
      "no-restricted-imports": SERVER_IMPORT_RULE,
    },
  },
  // Server-side surface is allowed (and required) to import *.server modules.
  {
    files: [
      "src/server/**/*.{ts,tsx}",
      "src/**/*.server.{ts,tsx}",
      "src/**/*.functions.{ts,tsx}",
      "src/integrations/supabase/auth-middleware.ts",
      "src/routes/api/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  eslintPluginPrettier,
);
