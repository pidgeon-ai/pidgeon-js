import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * `npx -y @pidgeon-ai/mcp init` — the install, as one command.
 *
 * The README has carried a correct block of JSON for as long as this package
 * has existed, and a block of JSON is not an install: somebody has to know
 * which file it goes in, paste it without breaking the file already there,
 * invent a name for the server, and then find out whether their key works by
 * asking a model to try.
 *
 * **The check is the part worth having.** A wrong key, a revoked key, or a
 * key granted no mailbox all fail the same way through an MCP client — the
 * tools are listed, the model calls one, and the answer is an error the
 * person never sees. This asks the API first and says what the key can
 * actually reach, which is the one question a copy-paste cannot answer.
 *
 * ## It writes `.mcp.json`, and says so
 *
 * That filename is the convention a project-scoped MCP config uses and
 * several clients read it from a project root. Deliberately **not** a map of
 * each client's own config path: those differ, they move between releases,
 * and a tool that writes confidently to the wrong one is worse than a tool
 * that writes somewhere predictable and tells you. The block it wrote is
 * printed either way, so moving it is a copy rather than a re-derivation.
 */

/** The server's name in the config. One word, because a person types it. */
const SERVER_NAME = 'pidgeon';

const CONFIG_FILE = '.mcp.json';

const DEFAULT_BASE_URL = 'https://pidgeon.ai/api/v1';

interface InitOptions {
  apiKey: string | undefined;
  baseUrl: string;
  cwd: string;
  write: boolean;
  force: boolean;
  fetch: typeof globalThis.fetch;
  out: (line: string) => void;
}

/** What goes in the config. The key is referenced, never printed. */
function configBlock(baseUrl: string): Record<string, unknown> {
  const env: Record<string, string> = { PIDGEON_API_KEY: '${PIDGEON_API_KEY}' };

  // Only when it is not production, so the common case stays the short case.
  if (baseUrl !== DEFAULT_BASE_URL) env.PIDGEON_BASE_URL = baseUrl;

  return { command: 'npx', args: ['-y', '@pidgeon-ai/mcp'], env };
}

export interface InitResult {
  ok: boolean;
  /** Addresses the key can reach, when the check ran. */
  addresses: string[];
  /** The highest rung it reaches on any of them, from `GET /v1/me`. */
  access: Access | null;
  wrote: string | null;
}

/** The rungs, lowest first. `admin` is what a key has unless narrowed. */
export type Access = 'read' | 'draft' | 'send' | 'admin';

/**
 * What a model can actually do with this key, said plainly.
 *
 * The reason this command now makes a second call. It printed which
 * addresses a key reaches and never what it may *do* with them, and an
 * agent builder reported the consequence on 15 October: *"`read` is the
 * thing that surprises someone later"* — later being the first time the
 * agent tries to answer an email and is refused, inside a model's tool
 * call, where the error is nobody's to read.
 *
 * A rung is also the one property of a key whose wrongness is silent at
 * setup. A revoked key fails immediately; a key granted nothing prints an
 * empty list. A key at `read` sets up perfectly and then cannot work.
 */
const WHAT_IT_CAN_DO: Record<Access, string> = {
  read: 'It can read mail and nothing else — a model holding it cannot reply, send or change anything.',
  draft:
    'It can read and manage mail and write drafts, and can never send — a person reviews each ' +
    'draft and sends it.',
  send: 'It can read and send. It cannot create addresses, mint keys or grant access.',
  admin: 'It can do everything the API offers, including creating addresses and granting access.',
};

export async function init(options: InitOptions): Promise<InitResult> {
  const { apiKey, baseUrl, cwd, write, force, fetch, out } = options;

  if (!apiKey) {
    out('PIDGEON_API_KEY is not set.');
    out('');
    out('Create one at https://pidgeon.ai/app/developers/keys, then:');
    out('  PIDGEON_API_KEY=pgn_live_… npx -y @pidgeon-ai/mcp init');
    out('');
    out('Give it the narrowest access the agent needs — this hands it to a model.');
    return { ok: false, addresses: [], access: null, wrote: null };
  }

  /*
   * The check, before anything is written. `GET /identities` is the cheapest
   * call that proves all three things at once: the key parses, it is live,
   * and it has been granted something. A key granted nothing returns an empty
   * list rather than an error, which is its own answer and a common one — a
   * key is created and the mailbox is granted separately.
   */
  const identity = await describeKey({ apiKey, baseUrl, fetch, out });
  if (identity === null) return { ok: false, addresses: [], access: null, wrote: null };

  const { addresses, access, reachesAll, expiresAt } = identity;

  if (addresses.length === 0) {
    out('That key works, and reaches no mailbox yet.');
    out('');
    out('Grant it one at https://pidgeon.ai/app/developers/keys — a key’s reach is');
    out('a snapshot, so an address created after the key is not in it.');
  } else {
    const shown = addresses.slice(0, 5);
    const reach = reachesAll
      ? `That key reaches every address this workspace owns (${addresses.length} today):`
      : `That key reaches ${addresses.length} address${addresses.length === 1 ? '' : 'es'}:`;

    out(reach);
    for (const address of shown) out(`  ${address}`);
    if (addresses.length > shown.length) out(`  … and ${addresses.length - shown.length} more`);

    if (reachesAll) {
      out('');
      out('An address created after this key will be in reach too, unlike a key');
      out('granted a fixed list.');
    }
  }

  /*
   * The rung, on its own line, whatever the reach. Printed even for a key
   * that reaches nothing: *what this key could do if you granted it
   * something* is the thing somebody is about to get wrong.
   */
  if (access) {
    out('');
    out(`Access: ${access}. ${WHAT_IT_CAN_DO[access]}`);
  }

  /*
   * And the date, which is the other way a key that works today stops.
   * `§342` gave keys an end; nothing told the person setting one up.
   */
  if (expiresAt) {
    const when = new Date(expiresAt);
    const stale = Number.isNaN(when.getTime());

    out('');
    out(
      stale
        ? `This key expires: ${expiresAt}.`
        : `This key stops working on ${when.toUTCString()}.`,
    );
  }

  const block = configBlock(baseUrl);
  const path = resolve(cwd, CONFIG_FILE);
  let wrote: string | null = null;

  if (write) {
    const result = merge(path, block, force);
    if (!result.ok) {
      out('');
      out(result.message);
      return { ok: false, addresses, access, wrote: null };
    }
    wrote = path;
  }

  out('');
  out(wrote ? `Wrote ${CONFIG_FILE}:` : `Add this to your MCP client’s config:`);
  out('');
  out(JSON.stringify({ mcpServers: { [SERVER_NAME]: block } }, null, 2));
  out('');
  out('The key is read from the environment rather than written into the file,');
  out('so the config can be committed and the credential cannot.');

  return { ok: true, addresses, access, wrote };
}

/**
 * Everything this command knows about the key, or `null` when the key itself
 * is the problem.
 *
 * **Two calls, in parallel, because they answer different questions.**
 * `GET /identities` names the addresses; `GET /v1/me` says what the
 * credential may do with them, which no other endpoint will tell you — the
 * reason that endpoint was built. They go together rather than in sequence
 * because neither depends on the other and this runs while somebody waits.
 *
 * `/v1/me` failing is not fatal on its own. It is newer than this command,
 * and a client pointed at a deployment that predates it should still get the
 * setup it came for — the rung is then simply unknown, which is honest, and
 * better than refusing to write a config over a field that did not exist
 * last month.
 */
async function describeKey(context: {
  apiKey: string;
  baseUrl: string;
  fetch: typeof globalThis.fetch;
  out: (line: string) => void;
}): Promise<{
  addresses: string[];
  access: Access | null;
  reachesAll: boolean;
  expiresAt: string | null;
} | null> {
  const [addresses, me] = await Promise.all([
    reachableAddresses(context),
    describeCredential(context),
  ]);

  if (addresses === null) return null;

  return {
    addresses,
    access: me?.key?.access ?? null,
    reachesAll: me?.key?.reaches_all_addresses ?? false,
    expiresAt: me?.key?.expires_at ?? null,
  };
}

/** `GET /v1/me`, or null on any failure. See `describeKey` for why. */
async function describeCredential(context: {
  apiKey: string;
  baseUrl: string;
  fetch: typeof globalThis.fetch;
}): Promise<{
  key: { access: Access; reaches_all_addresses: boolean; expires_at: string | null } | null;
} | null> {
  const { apiKey, baseUrl, fetch } = context;

  try {
    const response = await fetch(`${baseUrl}/me`, {
      headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
    });

    if (!response.ok) return null;

    const body = (await response.json()) as {
      data?: {
        key?: { access?: string; reaches_all_addresses?: boolean; expires_at?: string | null };
      };
    };

    const key = body.data?.key;
    if (!key?.access) return null;

    // A rung this client does not know is a rung it must not print.
    if (
      key.access !== 'read' &&
      key.access !== 'draft' &&
      key.access !== 'send' &&
      key.access !== 'admin'
    ) {
      return null;
    }

    return {
      key: {
        access: key.access,
        reaches_all_addresses: key.reaches_all_addresses ?? false,
        expires_at: key.expires_at ?? null,
      },
    };
  } catch {
    return null;
  }
}

/**
 * The addresses this key can reach, or `null` when the key is the problem.
 *
 * Every failure gets a sentence that says what to do, because "401" through
 * an MCP client is a model's problem and this is a person's.
 */
async function reachableAddresses(context: {
  apiKey: string;
  baseUrl: string;
  fetch: typeof globalThis.fetch;
  out: (line: string) => void;
}): Promise<string[] | null> {
  const { apiKey, baseUrl, fetch, out } = context;

  let response: Response;

  try {
    response = await fetch(`${baseUrl}/identities`, {
      headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
    });
  } catch (error) {
    out(`Could not reach ${baseUrl}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }

  if (response.status === 401 || response.status === 403) {
    out('That key was refused. It may be revoked, or from another deployment.');
    out('Keys live at https://pidgeon.ai/app/developers/keys.');
    return null;
  }

  if (!response.ok) {
    out(`The API answered ${response.status}. Nothing was written.`);
    return null;
  }

  const body = (await response.json()) as { data?: { email?: string }[] };
  return (body.data ?? []).map((identity) => identity.email ?? '').filter(Boolean);
}

/**
 * Add the entry without destroying what is already in the file.
 *
 * A developer running this in a project that already talks to three MCP
 * servers must not lose them, and one who runs it twice must not be told off.
 * An entry that is already ours and already correct is a no-op; one that is
 * ours and different is the only case that needs a decision, and the decision
 * is theirs.
 */
function merge(
  path: string,
  block: Record<string, unknown>,
  force: boolean,
): { ok: true } | { ok: false; message: string } {
  let existing: Record<string, unknown> = {};

  try {
    existing = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    // A missing file is the normal case. Anything else is a file we must not
    // overwrite, because we could not read what it holds.
    if ((error as { code?: string }).code !== 'ENOENT') {
      return {
        ok: false,
        message: `${path} exists and is not valid JSON, so nothing was written.`,
      };
    }
  }

  const servers = (existing.mcpServers ?? {}) as Record<string, unknown>;
  const current = servers[SERVER_NAME];

  if (current && !force && JSON.stringify(current) !== JSON.stringify(block)) {
    return {
      ok: false,
      message:
        `${path} already has a different "${SERVER_NAME}" server, so nothing was written.\n` +
        'Run again with --force to replace it, or edit the file by hand.',
    };
  }

  writeFileSync(
    path,
    `${JSON.stringify({ ...existing, mcpServers: { ...servers, [SERVER_NAME]: block } }, null, 2)}\n`,
  );

  return { ok: true };
}
