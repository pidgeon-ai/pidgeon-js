import { client, createConfig } from '@pidgeon-ai/sdk';
import * as sdk from '@pidgeon-ai/sdk';

import { COMMANDS, type Command, type Flag } from './commands.gen.js';

/**
 * `pidgeon <group> <command> --flags`, for every operation the API has.
 *
 * The table is generated from `public/openapi.json` (`pnpm cli:commands`)
 * and the calls go through `@pidgeon-ai/sdk`, which is generated from the
 * same document — so a command exists here because an operation exists
 * there, and it sends what that operation takes. Nothing in this file
 * knows the name of a single endpoint.
 *
 * `prd/one-source-of-capability.md`. The Python client, the TypeScript
 * client, the MCP server and this are four readings of one description.
 */

const DEFAULT_BASE_URL = 'https://pidgeon.ai/api/v1';

export interface Parsed {
  path: Record<string, string>;
  query: Record<string, unknown>;
  body: Record<string, unknown>;
  /** By the flag's name; `run` sends each under the header's own spelling. */
  header: Record<string, unknown>;
}

/** Where `--verbose` lines go. Never stdout, which carries the answer a script parses. */
export interface RunOptions {
  stderr?: (line: string) => void;
}

export class UsageError extends Error {}

/**
 * The API said no. Not a `UsageError`: the command was well-formed and the
 * answer is the API's, so it exits 1 and leads with the API's `code`, which
 * is what a script or an agent branches on. A refused send used to exit 2
 * with only the sentence, which reads like a typo in the flags.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
  ) {
    super(code ? `${status} ${code}: ${message}` : `${status}: ${message}`);
  }
}

/** One flag's value, in the shape the API declared. */
function coerce(flag: Flag, raw: string): unknown {
  if (flag.kind === 'number') {
    const value = Number(raw);
    if (Number.isNaN(value)) throw new UsageError(`--${flag.name} takes a number, not "${raw}".`);
    return value;
  }

  if (flag.kind === 'json') {
    try {
      return JSON.parse(raw);
    } catch {
      throw new UsageError(`--${flag.name} takes JSON, and that did not parse.`);
    }
  }

  return raw;
}

/**
 * `--flag value`, `--flag=value`, and `--flag` alone for a boolean.
 *
 * Hand-rolled rather than a parser dependency, which is worth the forty
 * lines: the flags are not known until the table is read, so a declarative
 * parser would be configured from the same loop this is.
 */
export function parse(command: Command, argv: string[]): Parsed {
  const byName = new Map(command.flags.map((flag) => [flag.name, flag]));
  const out: Parsed = { path: {}, query: {}, body: {}, header: {} };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;

    if (!token.startsWith('--')) throw new UsageError(`Unexpected argument "${token}".`);

    /*
     * Split on the first `=` only, keeping everything after it — a subject
     * may contain one. `[\s\S]` rather than the `s` flag, which the root
     * tsconfig's target does not allow.
     */
    const [name, inline] = token.slice(2).split(/=([\s\S]*)/, 2) as [string, string | undefined];
    const flag = byName.get(name);

    if (!flag) {
      throw new UsageError(
        `\`${command.group} ${command.name}\` has no --${name}. Try \`pidgeon ${command.group} ${command.name} --help\`.`,
      );
    }

    if (flag.kind === 'boolean') {
      out[flag.where][name] = inline === undefined ? true : inline === 'true';
      continue;
    }

    const raw = inline ?? argv[++i];
    if (raw === undefined) throw new UsageError(`--${name} needs a value.`);

    if (flag.kind === 'list') {
      /* Repeatable: `--to a@b.test --to c@d.test`. */
      const existing = (out[flag.where][name] as unknown[] | undefined) ?? [];
      out[flag.where][name] = [...existing, raw];
      continue;
    }

    out[flag.where][name] = coerce(flag, raw);
  }

  const missing = command.flags
    .filter((flag) => flag.required)
    .filter((flag) => out[flag.where][flag.name] === undefined)
    .map((flag) => `--${flag.name}`);

  if (missing.length > 0) {
    throw new UsageError(`\`${command.group} ${command.name}\` needs ${missing.join(', ')}.`);
  }

  return out;
}

export function help(command?: Command): string {
  if (!command) {
    const groups = [...new Set(COMMANDS.map((c) => c.group))].sort();
    return [
      'pidgeon <group> <command> [--flags]',
      '',
      'Groups:',
      ...groups.map((group) => {
        const names = COMMANDS.filter((c) => c.group === group).map((c) => c.name);
        return `  ${group.padEnd(14)}${names.join(', ')}`;
      }),
      '',
      'An API key goes in PIDGEON_API_KEY. `pidgeon <group> <command> --help`',
      'describes one command; --verbose prints what was sent, on stderr.',
    ].join('\n');
  }

  const flags = command.flags.map((flag) => {
    /*
     * The values, where there are values — `<open|reply_only|list>` rather
     * than `<string>`. They are in the contract and the generated table
     * dropped them, so help described three legal answers as "a string" and
     * the only way to find `reply_only` was to read `openapi.json`.
     */
    const takes = flag.choices?.length ? flag.choices.join('|') : flag.kind;
    const label = `  --${flag.name}${flag.kind === 'boolean' ? '' : ` <${takes}>`}`;
    const note = [flag.required ? 'required' : null, flag.describe].filter(Boolean).join(' — ');
    if (!note) return label;

    /*
     * Two spaces when the label is already past the column, rather than
     * none. `padEnd` returns the string unchanged when it is longer than the
     * width, so a long enum — `--type <human|team|application|workflow|agent>`
     * — ran straight into its own description with nothing between them.
     */
    return `${label.padEnd(34)}${label.length >= 34 ? '  ' : ''}${note}`;
  });

  return [
    `pidgeon ${command.group} ${command.name} [--flags]`,
    '',
    `  ${command.summary}`,
    `  ${command.method} ${command.path}`,
    '',
    ...(flags.length > 0 ? ['Flags:', ...flags] : ['Takes no flags.']),
  ].join('\n');
}

/**
 * The headers a command sends, by their own spelling.
 *
 * **An `Idempotency-Key` is made up when none is given**, one per
 * invocation. Unlike the SDK, which makes up none (a key the caller never
 * sees protects nothing), the CLI can show it: `--verbose` prints it before
 * the call and a failure that may have sent says it, so a script retries
 * with it and the message goes out once. `docs/email.md`.
 */
function headersFor(command: Command, parsed: Parsed): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const flag of command.flags) {
    if (flag.where !== 'header' || !flag.header) continue;

    const given = parsed.header[flag.name];
    if (typeof given === 'string') headers[flag.header] = given;
    else if (flag.header === 'Idempotency-Key') headers[flag.header] = crypto.randomUUID();
  }

  return headers;
}

export function find(group?: string, name?: string): Command | undefined {
  return COMMANDS.find((c) => c.group === group && c.name === name);
}

export async function run(
  argv: string[],
  env: NodeJS.ProcessEnv,
  options: RunOptions = {},
): Promise<string> {
  const verbose = argv.includes('--verbose');
  const [group, name, ...rest] = argv.filter((token) => token !== '--verbose');

  if (!group || group === '--help' || group === 'help') return help();

  const command = find(group, name);

  if (!command) {
    const known = COMMANDS.filter((c) => c.group === group);
    if (known.length === 0) throw new UsageError(`No such group "${group}".\n\n${help()}`);

    throw new UsageError(
      `\`${group}\` has no "${name ?? ''}" command. It has: ${known.map((c) => c.name).join(', ')}.`,
    );
  }

  if (rest.includes('--help')) return help(command);

  const apiKey = env.PIDGEON_API_KEY;
  if (!apiKey) {
    throw new UsageError(
      'PIDGEON_API_KEY is not set. Create a key at https://pidgeon.ai/app/developers/keys.',
    );
  }

  const parsed = parse(command, rest);
  const headers = headersFor(command, parsed);
  const idempotencyKey = headers['Idempotency-Key'];

  /*
   * Before the call, so a script still has the key when the call never
   * answers — which is the case the key is for.
   */
  if (verbose && idempotencyKey) options.stderr?.(`Idempotency-Key: ${idempotencyKey}`);

  client.setConfig(
    createConfig({ baseUrl: env.PIDGEON_BASE_URL ?? DEFAULT_BASE_URL, auth: () => apiKey }),
  );

  /*
   * By `operationId`, which is the SDK's exported name — §343's whole
   * point. A table of endpoint strings here would be a second place a path
   * can be spelled wrong.
   */
  const call = (sdk as unknown as Record<string, unknown>)[command.operationId];
  if (typeof call !== 'function') {
    throw new Error(`The SDK does not export \`${command.operationId}\`. Run \`pnpm sdk\`.`);
  }

  const retry = idempotencyKey
    ? ` It may have been sent: retry with --idempotency-key ${idempotencyKey} and it goes out at most once.`
    : '';

  let answer: { data?: unknown; error?: unknown; response: Response };

  try {
    answer = await (
      call as (options: unknown) => Promise<{ data?: unknown; error?: unknown; response: Response }>
    )({
      ...(Object.keys(parsed.path).length > 0 ? { path: parsed.path } : {}),
      ...(Object.keys(parsed.query).length > 0 ? { query: parsed.query } : {}),
      ...(Object.keys(parsed.body).length > 0 ? { body: parsed.body } : {}),
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    });
  } catch (thrown) {
    /* No answer at all: the request may or may not have arrived. */
    const reason = thrown instanceof Error ? thrown.message : 'The request failed.';
    throw new Error(`${reason}${retry ? `\n${retry.trim()}` : ''}`);
  }

  const { data, error, response } = answer;

  if (verbose && response.headers.get('Idempotent-Replay') === 'true') {
    options.stderr?.('Idempotent-Replay: true — answered from the first send; nothing sent again.');
  }

  /*
   * Any status that is not a success, declared in the contract or not: the
   * client puts every one of them in `error`, so an undeclared refusal fails
   * here the same as a declared one.
   */
  if (error !== undefined) {
    const detail = (error as { error?: { message?: string; code?: string } } | undefined)?.error;
    const message =
      detail?.message ??
      (typeof error === 'string' && error ? error.slice(0, 500) : 'The request failed.');

    /*
     * A 5xx may have come after the send (a gateway timing out on a send
     * that finished), so it says how to retry safely. A 4xx is the API's
     * refusal and nothing went out; a retry would only be refused again.
     */
    throw new ApiError(
      response.status,
      detail?.code,
      response.status >= 500 ? message + retry : message,
    );
  }

  return JSON.stringify(data, null, 2);
}
