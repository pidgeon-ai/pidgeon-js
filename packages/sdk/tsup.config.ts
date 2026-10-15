import { defineConfig } from 'tsup';

/**
 * Build.
 *
 * The package shipped as raw TypeScript for a while — `main` pointed at
 * `src/index.ts` — which meant no JavaScript consumer could import it at
 * all, and that is most of the market. Hence a build.
 *
 * Dual format because both callers exist: `import` from an ESM app,
 * `require` from the large amount of Node that is still CommonJS. The
 * `types` condition is listed first in `exports` so TypeScript resolves
 * declarations before it resolves code, which is the ordering that stops
 * editors falling back to `any`.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  // Zero runtime dependencies is a promise this package makes; bundling
  // would be how one arrives without anyone deciding to add it.
  external: [],
  target: 'es2022',
});
