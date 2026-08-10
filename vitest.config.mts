import { defineConfig } from "vitest/config";

// Pure Node/TS unit tests for the business logic under src/ (see CLAUDE.md's
// Commands section: Vitest is the pre-approved test runner for this repo).
//
// The default environment stays `node` deliberately: the overwhelming majority
// of tests here are pure-logic tests with no DOM dependency, and running them
// in jsdom would cost startup time and quietly let DOM globals leak into
// modules that are supposed to be environment-agnostic.
//
// DOM-dependent tests (React hooks, browser-API wrappers) opt in *per file*
// with a docblock on line 1:
//
//     // @vitest-environment jsdom
//
// This is the supported mechanism in Vitest 4. Note that the previously
// suggested `environmentMatchGlobs` option was removed in Vitest 4 — the
// alternatives are this docblock or a full `test.projects` split, and the
// docblock is used here because it keeps one config, one `include` glob, and
// makes each file's environment visible at the top of that file rather than in
// a glob list somewhere else. Revisit `test.projects` if DOM tests ever need
// different setup files / globals from the Node ones.
//
// `resolve.tsconfigPaths` resolves the `@/*` -> `./src/*` alias declared in
// tsconfig.json the same way Next.js does, so `import { x } from "@/lib/..."`
// works in tests exactly like it does in the app.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
