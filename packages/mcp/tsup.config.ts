import { defineConfig } from 'tsup';

/**
 * Build.
 *
 * ESM only, unlike the SDK. That package is a library other people's builds
 * consume and some of that world is still CommonJS; this one is a **binary**
 * an MCP client spawns, so there is exactly one consumer and it is Node.
 *
 * Dependencies stay external. Bundling the protocol SDK would pin a copy of
 * it inside our artefact and make a version skew between us and the client
 * impossible to fix without a release here.
 */
export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ['@modelcontextprotocol/sdk', '@pidgeon-ai/sdk', 'zod'],
  target: 'es2022',
  /*
   * The shebang goes on both, which costs nothing on the library and is
   * required on the binary — `bin` points at `dist/cli.js` now, because a
   * library that runs `main()` on import killed its host. §345.
   */
  banner: { js: '#!/usr/bin/env node' },
});
