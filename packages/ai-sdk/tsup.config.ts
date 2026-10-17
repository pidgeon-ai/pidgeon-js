import { defineConfig } from 'tsup';

/**
 * Build.
 *
 * ESM only, like the MCP server: the AI SDK this plugs into is ESM, so there
 * is no CommonJS consumer to serve.
 *
 * `ai`, `zod` and the SDK stay external — `ai` is the caller's, and a copy
 * bundled here would be a second `tool()` whose types disagree with theirs.
 * The MCP tool list is the one thing bundled in, from `../mcp/src/tools.ts`,
 * so the package does not depend on the MCP server to describe its tools.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ['ai', 'zod', '@pidgeon-ai/sdk'],
  target: 'es2022',
});
