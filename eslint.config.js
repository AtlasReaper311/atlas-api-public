// Flat config, no plugin dependencies: the estate gate is "does the
// Worker parse and avoid the obvious footguns", not a style debate.
// Mirrors atlas-api-index; test files pick up node globals.
export default [
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        Response: "readonly",
        Request: "readonly",
        URL: "readonly",
        fetch: "readonly",
        console: "readonly",
        AbortSignal: "readonly",
        caches: "readonly",
        TextEncoder: "readonly",
        Date: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-var": "error",
      "prefer-const": "error",
      eqeqeq: "error",
    },
  },
  {
    files: ["test/**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        Response: "readonly",
        Request: "readonly",
        URL: "readonly",
        fetch: "writable",
        console: "readonly",
        globalThis: "writable",
      },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      eqeqeq: "error",
    },
  },
];
