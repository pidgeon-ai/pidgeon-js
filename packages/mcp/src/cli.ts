import { main } from './index.js';

/**
 * The binary, and the only thing in this package that runs anything.
 *
 * `index.ts` is a library: it is imported by the tests, and by the hosted
 * server at `src/app/api/mcp/route.ts`, and neither wants a stdio transport
 * opened as a side effect of an import. It used to run `main()` at the
 * bottom of the module behind an environment-variable guard, which killed
 * the web server the first time the route imported it. §345.
 *
 * So the side effect lives here, in the file `bin` points at, which nothing
 * imports.
 */
void main();
