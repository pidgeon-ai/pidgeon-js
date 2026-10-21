import { defineConfig } from 'tsup';

/**
 * Build.
 *
 * ESM, one entry, the way OpenClaw loads an extension. `openclaw/*` stays
 * external: the plugin SDK is the host's, resolved from the Gateway that loads
 * this file, never a copy bundled here.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  // No declarations: nothing imports this package; OpenClaw loads it.
  dts: false,
  sourcemap: true,
  clean: true,
  external: [/^openclaw(\/.*)?$/],
  target: 'es2022',
});
