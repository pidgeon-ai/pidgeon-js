import { defineConfig } from 'tsup';

/**
 * Build.
 *
 * `index.ts` is the library an agent imports; `bin.ts` is `npx
 * @pidgeon-ai/id`. The Ed25519 is `post-core`'s WebAssembly, the app's own
 * copy (`src/lib/post/wasm`), bundled in rather than depended on, so the
 * library and the server cannot sign with different maths.
 */
export default defineConfig({
  entry: ['src/index.ts', 'src/bin.ts'],
  format: ['esm'],
  dts: { entry: 'src/index.ts' },
  sourcemap: true,
  clean: true,
  target: 'es2022',
  banner: { js: '#!/usr/bin/env node' },
});
