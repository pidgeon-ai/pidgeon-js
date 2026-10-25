import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { applyEdits, type FormattingOptions, modify, parse, type ParseError } from 'jsonc-parser';
import { parse as parseToml } from 'smol-toml';

/**
 * `init --client codex|vscode|gemini`: the hosted server, in the file that
 * client reads.
 *
 * The bare `init` writes `.mcp.json` and says so, because a map of every
 * client's config path is a map that goes stale. These three are the
 * exception, each looked up in the client's own docs and source on 25
 * October 2026, because each has one documented file, a format of its own,
 * and a way to reach a remote server over streamable HTTP — so the right
 * entry is the hosted `/api/mcp`, not a local `npx` process:
 *
 * | Client  | File (default scope)                          | Remote server         | Key, never in the file          |
 * | ------- | --------------------------------------------- | --------------------- | ------------------------------- |
 * | Codex   | `~/.codex/config.toml` (`$CODEX_HOME`), user   | `url`                 | `bearer_token_env_var`          |
 * | VS Code | `.vscode/mcp.json`, workspace                 | `type: "http"`, `url` | `${input:…}`, a password prompt |
 * | Gemini  | `.gemini/settings.json`, project              | `httpUrl` (not `url`) | `${PIDGEON_API_KEY}` in headers |
 *
 * **With no key it writes the URL alone, and the client signs in.** All
 * three answer the server's `401` with OAuth: Codex and VS Code by CIMD or
 * DCR, Gemini CLI by DCR (it has no CIMD).
 *
 * **It edits, never rewrites.** VS Code's and Gemini's files are JSON with
 * comments, so the entry goes in through `jsonc-parser`'s edits and every
 * comment and other server stays where it was. TOML is edited as text — the
 * table appended, or replaced between its header and the next — and the
 * result is parsed again and must hold exactly the old file plus our entry,
 * or nothing is written. A file it cannot parse is never touched; a
 * `pidgeon` entry that differs is replaced only with `--force`; the same
 * entry is a no-op; and a file that changes is copied to `<file>.bak` first.
 */

export const CLIENTS = ['codex', 'vscode', 'gemini'] as const;
export type Client = (typeof CLIENTS)[number];

export type Scope = 'user' | 'project';

const SERVER_NAME = 'pidgeon';

/** The variable the key is read from, wherever the client can read one. */
const KEY_VARIABLE = 'PIDGEON_API_KEY';

/** VS Code's prompt for the key: asked once, kept in its secret storage. */
const VSCODE_INPUT = {
  type: 'promptString',
  id: 'pidgeon-key',
  description: 'Pidgeon API key',
  password: true,
};

/**
 * `await_message` holds a request open for up to 280 seconds. Codex's docs
 * give 60 as the default tool timeout and its source 300, so it is said
 * rather than left to whichever is true. VS Code sets none, and Gemini's
 * default is ten minutes.
 */
const CODEX_TOOL_TIMEOUT_SEC = 300;

export const CLIENT_NAMES: Record<Client, string> = {
  codex: 'Codex',
  vscode: 'VS Code',
  gemini: 'Gemini CLI',
};

export interface Where {
  cwd: string;
  home: string;
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
}

export function defaultScope(client: Client): Scope {
  // Codex reads a project's file only once the project is trusted; `codex
  // mcp add` writes the user's. VS Code and Gemini default to the workspace.
  return client === 'codex' ? 'user' : 'project';
}

export function configPath(client: Client, scope: Scope, where: Where): string {
  const { cwd, home, platform, env } = where;

  if (client === 'codex') {
    if (scope === 'project') return resolve(cwd, '.codex', 'config.toml');
    return join(env.CODEX_HOME || join(home, '.codex'), 'config.toml');
  }

  if (client === 'gemini') {
    return scope === 'project'
      ? resolve(cwd, '.gemini', 'settings.json')
      : join(home, '.gemini', 'settings.json');
  }

  if (scope === 'project') return resolve(cwd, '.vscode', 'mcp.json');

  // The default profile's folder, beside its settings.json.
  if (platform === 'darwin')
    return join(home, 'Library', 'Application Support', 'Code', 'User', 'mcp.json');
  if (platform === 'win32') {
    return join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'Code', 'User', 'mcp.json');
  }
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), 'Code', 'User', 'mcp.json');
}

/** The entry for this client, and for VS Code the prompt it refers to. */
export function entry(client: Client, mcpUrl: string, withKey: boolean): Record<string, unknown> {
  if (client === 'codex') {
    return withKey
      ? {
          url: mcpUrl,
          bearer_token_env_var: KEY_VARIABLE,
          tool_timeout_sec: CODEX_TOOL_TIMEOUT_SEC,
        }
      : { url: mcpUrl, tool_timeout_sec: CODEX_TOOL_TIMEOUT_SEC };
  }

  if (client === 'gemini') {
    return withKey
      ? { httpUrl: mcpUrl, headers: { Authorization: `Bearer \${${KEY_VARIABLE}}` } }
      : { httpUrl: mcpUrl };
  }

  return withKey
    ? {
        type: 'http',
        url: mcpUrl,
        headers: { Authorization: `Bearer \${input:${VSCODE_INPUT.id}}` },
      }
    : { type: 'http', url: mcpUrl };
}

/** What a person does next, once the file is written. */
export function nextSteps(client: Client, withKey: boolean): string[] {
  if (withKey) {
    if (client === 'codex') {
      return [
        `Codex reads the key from ${KEY_VARIABLE}, so keep it in the environment Codex starts in.`,
      ];
    }
    if (client === 'gemini') {
      return [`Gemini CLI reads the key from ${KEY_VARIABLE} when it loads its settings.`];
    }
    return [
      'VS Code asks for the key the first time the server starts, and keeps it in its secret storage.',
    ];
  }

  if (client === 'codex') return ['Sign in:', '  codex mcp login pidgeon'];
  if (client === 'gemini') return ['Sign in, inside Gemini CLI:', '  /mcp auth pidgeon'];
  return ['When the server first starts, VS Code sends you to Pidgeon to sign in.'];
}

export type WriteResult =
  | { ok: true; changed: boolean; backup: string | null; text: string }
  | { ok: false; message: string };

/**
 * The file as it would be with our entry in it, without writing anything.
 * `current` is null when there is no file.
 */
export function edit(
  client: Client,
  path: string,
  current: string | null,
  block: Record<string, unknown>,
  force: boolean,
): { ok: true; text: string } | { ok: false; message: string } {
  return client === 'codex'
    ? editToml(path, current, block, force)
    : editJson(client, path, current, block, force);
}

/** Write the entry into the client's file. See the module comment for the rules. */
export function writeClientConfig(
  client: Client,
  path: string,
  block: Record<string, unknown>,
  force: boolean,
): WriteResult {
  let current: string | null = null;

  try {
    current = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as { code?: string }).code !== 'ENOENT') {
      return { ok: false, message: `${path} could not be read, so nothing was written.` };
    }
  }

  const result = edit(client, path, current, block, force);
  if (!result.ok) return result;

  if (result.text === current) return { ok: true, changed: false, backup: null, text: result.text };

  let backup: string | null = null;
  if (current !== null) {
    backup = `${path}.bak`;
    copyFileSync(path, backup);
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, result.text);

  return { ok: true, changed: true, backup, text: result.text };
}

function differs(path: string): string {
  return (
    `${path} already has a different "${SERVER_NAME}" server, so nothing was written.\n` +
    'Run again with --force to replace it, or edit the file by hand.'
  );
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;

  return keysA.every((key) =>
    same((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

/* ---------- JSON with comments: VS Code and Gemini CLI ---------- */

function editJson(
  client: Exclude<Client, 'codex'>,
  path: string,
  current: string | null,
  block: Record<string, unknown>,
  force: boolean,
): { ok: true; text: string } | { ok: false; message: string } {
  const text = current ?? '{}';

  const errors: ParseError[] = [];
  const parsed = parse(text, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  }) as unknown;

  if (errors.length > 0 || typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, message: `${path} exists and is not valid JSON, so nothing was written.` };
  }

  const root = parsed as Record<string, unknown>;
  const key = client === 'vscode' ? 'servers' : 'mcpServers';
  const servers = root[key];

  if (
    servers !== undefined &&
    (typeof servers !== 'object' || servers === null || Array.isArray(servers))
  ) {
    return { ok: false, message: `"${key}" in ${path} is not an object, so nothing was written.` };
  }

  const existing = (servers as Record<string, unknown> | undefined)?.[SERVER_NAME];
  if (existing !== undefined && !same(existing, block) && !force) {
    return { ok: false, message: differs(path) };
  }

  const formatting = formattingOf(text);
  let next = text;

  if (!same(existing, block)) {
    next = applyEdits(
      next,
      modify(next, [key, SERVER_NAME], block, { formattingOptions: formatting }),
    );
  }

  // The prompt a key-mode entry refers to, added once and never duplicated.
  if (client === 'vscode' && JSON.stringify(block).includes('${input:')) {
    const inputs = root.inputs;

    if (inputs !== undefined && !Array.isArray(inputs)) {
      return { ok: false, message: `"inputs" in ${path} is not a list, so nothing was written.` };
    }

    const at = (inputs ?? []).findIndex(
      (input) => (input as { id?: unknown } | null)?.id === VSCODE_INPUT.id,
    );

    if (at === -1) {
      next = applyEdits(
        next,
        modify(next, ['inputs', -1], VSCODE_INPUT, {
          formattingOptions: formatting,
          isArrayInsertion: true,
        }),
      );
    } else if (!same(inputs![at], VSCODE_INPUT)) {
      if (!force) return { ok: false, message: differs(path) };
      next = applyEdits(
        next,
        modify(next, ['inputs', at], VSCODE_INPUT, { formattingOptions: formatting }),
      );
    }
  }

  // A new file ends in a newline; an existing one keeps its own ending.
  if (current === null) next = `${next.trimEnd()}\n`;

  return { ok: true, text: next };
}

/** Indent like the file already does, or two spaces. */
function formattingOf(text: string): FormattingOptions {
  const indent = /\n([ \t]+)\S/.exec(text)?.[1];

  if (indent?.startsWith('\t')) return { insertSpaces: false, tabSize: 1, eol: '\n' };
  return {
    insertSpaces: true,
    tabSize: indent ? indent.length : 2,
    eol: text.includes('\r\n') ? '\r\n' : '\n',
  };
}

/* ---------- TOML: Codex ---------- */

/** `[mcp_servers.pidgeon]`, or a table under it, however it is quoted and spaced. */
const OUR_TABLE =
  /^\s*\[\s*mcp_servers\s*\.\s*(?:pidgeon|"pidgeon"|'pidgeon')\s*(?:\.[^\]]*)?\]\s*(?:#.*)?$/;

/** Any table header, `[x]` or `[[x]]`. */
const ANY_TABLE = /^\s*\[/;

function editToml(
  path: string,
  current: string | null,
  block: Record<string, unknown>,
  force: boolean,
): { ok: true; text: string } | { ok: false; message: string } {
  const text = current ?? '';

  let before: Record<string, unknown>;
  try {
    before = parseToml(text) as Record<string, unknown>;
  } catch {
    return { ok: false, message: `${path} exists and is not valid TOML, so nothing was written.` };
  }

  const servers = before.mcp_servers as Record<string, unknown> | undefined;
  const existing = servers?.[SERVER_NAME];

  if (existing !== undefined && same(existing, block)) return { ok: true, text };
  if (existing !== undefined && !force) return { ok: false, message: differs(path) };

  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const table = [
    `[mcp_servers.${SERVER_NAME}]`,
    ...Object.entries(block).map(([k, v]) => `${k} = ${tomlValue(v)}`),
  ];

  let next: string;

  if (existing === undefined) {
    const body = text.replace(/\s*$/, '');
    next = `${body}${body ? `${eol}${eol}` : ''}${table.join(eol)}${eol}`;
  } else {
    const lines = text.split(/\r?\n/);
    const start = lines.findIndex((line) => OUR_TABLE.test(line));

    // Defined some other way — dotted keys, an inline table. Not ours to rewrite.
    if (start === -1) {
      return {
        ok: false,
        message: `${path} defines "${SERVER_NAME}" in a form this cannot edit safely, so nothing was written.`,
      };
    }

    let end = start + 1;
    while (end < lines.length && (!ANY_TABLE.test(lines[end]!) || OUR_TABLE.test(lines[end]!)))
      end += 1;

    // Leave the blank lines before the next table where they were.
    let keep = end;
    while (keep > start + 1 && lines[keep - 1]!.trim() === '') keep -= 1;

    next = [...lines.slice(0, start), ...table, ...lines.slice(keep)].join(eol);
    if (!next.endsWith(eol)) next = `${next}${eol}`;
  }

  // The proof: the new file is the old one plus our entry, and nothing else.
  let after: Record<string, unknown>;
  try {
    after = parseToml(next) as Record<string, unknown>;
  } catch {
    return { ok: false, message: `Editing ${path} would have broken it, so nothing was written.` };
  }

  const expected = {
    ...before,
    mcp_servers: { ...(servers ?? {}), [SERVER_NAME]: block },
  };

  if (!same(after, expected)) {
    return {
      ok: false,
      message: `${path} is laid out in a way this cannot edit safely, so nothing was written.`,
    };
  }

  return { ok: true, text: next };
}

function tomlValue(value: unknown): string {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(String(value));
}

/** The block, as the client's file would show it, for printing. */
export function render(client: Client, block: Record<string, unknown>): string {
  if (client === 'codex') {
    return [
      `[mcp_servers.${SERVER_NAME}]`,
      ...Object.entries(block).map(([k, v]) => `${k} = ${tomlValue(v)}`),
    ].join('\n');
  }

  const withKey = JSON.stringify(block).includes('${input:');
  const shape =
    client === 'vscode'
      ? { ...(withKey ? { inputs: [VSCODE_INPUT] } : {}), servers: { [SERVER_NAME]: block } }
      : { mcpServers: { [SERVER_NAME]: block } };

  return JSON.stringify(shape, null, 2);
}
