import { run, UsageError } from './index.js';

/**
 * The binary. Nothing else in this package runs anything.
 *
 * The same split the MCP package learned the hard way in §345: a module
 * that executes on import kills whatever imports it, and the tests import
 * `run` to drive it without a process.
 */
async function main() {
  try {
    process.stdout.write(`${await run(process.argv.slice(2), process.env)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Something went wrong.';
    process.stderr.write(`${message}\n`);
    process.exit(error instanceof UsageError ? 2 : 1);
  }
}

void main();
