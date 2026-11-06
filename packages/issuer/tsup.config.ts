import { defineConfig } from 'tsup';

/**
 * Build. `index` is the issuer as a library (a Web `Request` handler);
 * `bin` is `pidgeon-issuer`, the server and its commands. `@pidgeon-ai/id`
 * (and through it `post-core`'s WebAssembly) is bundled in, so the issuer,
 * the agents and Pidgeon Cloud sign with the same maths, and the container
 * needs nothing but Node.
 */
export default defineConfig({
  entry: ['src/index.ts', 'src/bin.ts'],
  format: ['esm'],
  dts: { entry: 'src/index.ts' },
  sourcemap: true,
  clean: true,
  target: 'es2022',
  noExternal: ['@pidgeon-ai/id'],
});
