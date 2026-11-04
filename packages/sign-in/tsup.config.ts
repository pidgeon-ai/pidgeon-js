import { defineConfig } from 'tsup';

/**
 * Build. `index` is the framework-free core on Web `Request`/`Response`;
 * `next` and `express` adapt it. `@pidgeon-ai/id`'s request verifier is
 * bundled in, as the CLI bundles it, so a site installs one package.
 */
export default defineConfig({
  entry: ['src/index.ts', 'src/next.ts', 'src/express.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  noExternal: ['@pidgeon-ai/id'],
});
