import { runIssuer, UsageError } from './cli';

/** `pidgeon-issuer <command>`. Nothing else in this package runs anything on import. */
async function main() {
  try {
    process.stdout.write(
      `${await runIssuer(process.argv.slice(2), process.env, {
        log: (line) => process.stderr.write(`${line}\n`),
      })}\n`,
    );
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Something went wrong.'}\n`);
    process.exit(error instanceof UsageError ? 2 : 1);
  }
}

void main();
