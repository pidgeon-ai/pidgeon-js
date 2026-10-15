import { defineConfig } from 'tsup';

/**
 * Build.
 *
 * Two entries, for the reason §345 cost a web server: `index.ts` is a
 * library the tests import, `cli.ts` is the binary that runs. The shebang
 * goes on both, which costs nothing on the library.
 *
 * The SDK is bundled rather than external. It is generated and has no
 * dependencies of its own, and a globally installed binary that needs a
 * peer resolved at the user's cwd is a binary that breaks in half the
 * places it is run.
 */
export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts', 'src/commands.gen.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  noExternal: ['@pidgeon-ai/sdk'],
  target: 'es2022',
  banner: { js: '#!/usr/bin/env node' },
});
