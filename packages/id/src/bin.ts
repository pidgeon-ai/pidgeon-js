import { runId, UsageError } from './cli';

/**
 * `npx @pidgeon-ai/id <command>`. Nothing else in this package runs anything
 * on import (the CLI's §345 lesson), so `runId` can be driven from a test.
 */
async function main() {
  try {
    process.stdout.write(
      `${await runId(process.argv.slice(2), process.env, {
        stderr: (line) => process.stderr.write(`${line}\n`),
      })}\n`,
    );
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Something went wrong.'}\n`);
    process.exit(error instanceof UsageError ? 2 : 1);
  }
}

void main();
