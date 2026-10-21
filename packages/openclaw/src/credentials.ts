/**
 * Where the channel's Pidgeon credential comes from, in order:
 *
 * 1. **A key in the Gateway's environment**, named by `apiKeyEnv`
 *    (`PIDGEON_API_KEY` unless set). For a server with nobody there to sign
 *    in. Never in `openclaw.json`.
 * 2. **A sign-in**, saved by `openclaw channels login --channel pidgeon` in
 *    `<state dir>/pidgeon/<account>.json`, readable by its owner only. Pidgeon
 *    issues an access token for an hour and a refresh token that rotates on
 *    every use; this file always holds the newest pair, so a Gateway restart
 *    resumes where the last one stopped.
 *
 * The file is read on every refresh rather than cached across them, because
 * `channels login` runs in the CLI process while the Gateway is a different
 * one, and a sign-in made while the Gateway runs must reach it.
 */
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { ResolvedAccount } from './config.js';

export interface StoredSignIn {
  baseUrl: string;
  clientId: string;
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  /** The workspace and access chosen at consent, for status lines. */
  scope?: string;
}

export interface Credential {
  kind: 'key' | 'sign-in';
  /** Where it came from, for status lines: `$PIDGEON_API_KEY`, or the file. */
  source: string;
  token: () => Promise<string>;
  /** After a 401. A key has nothing to refresh. */
  refresh: () => Promise<void>;
}

export function signInPath(stateDir: string, accountId: string): string {
  return join(stateDir, 'pidgeon', `${accountId.replace(/[^\w.-]/g, '_')}.json`);
}

export async function readSignIn(path: string): Promise<StoredSignIn | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as StoredSignIn;
  } catch {
    return null;
  }
}

/** Written whole and renamed into place, so a reader never sees half a file. */
export async function writeSignIn(path: string, value: StoredSignIn): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

export async function removeSignIn(path: string): Promise<boolean> {
  try {
    await rm(path);
    return true;
  } catch {
    return false;
  }
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

/** POST to `/api/oauth/token`, form-encoded as RFC 6749 asks. */
export async function exchange(
  baseUrl: string,
  params: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<TokenResponse> {
  const response = await fetchImpl(`${baseUrl}/api/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(params).toString(),
  });
  const body = (await response.json().catch(() => ({}))) as TokenResponse & {
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !body.access_token) {
    throw new Error(
      body.error_description ??
        body.error ??
        `Pidgeon answered ${response.status} when asked for a token.`,
    );
  }
  return body;
}

export function storedFrom(
  baseUrl: string,
  clientId: string,
  tokens: TokenResponse,
  previousRefresh?: string,
  now = Date.now(),
): StoredSignIn {
  return {
    baseUrl,
    clientId,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? previousRefresh ?? '',
    expiresAt: now + (tokens.expires_in ?? 3600) * 1000,
    scope: tokens.scope,
  };
}

/** A minute early, so a token is never presented in its last seconds. */
const EARLY_MS = 60_000;

/**
 * The credential for one account, or `null` when there is none: no key in
 * the environment and no sign-in on disk.
 */
export async function resolveCredential(params: {
  account: ResolvedAccount;
  stateDir: string;
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  now?: () => number;
}): Promise<Credential | null> {
  const env = params.env ?? process.env;
  const key = env[params.account.apiKeyEnv]?.trim();
  if (key) {
    return {
      kind: 'key',
      source: `$${params.account.apiKeyEnv}`,
      token: async () => key,
      refresh: async () => {},
    };
  }

  const path = signInPath(params.stateDir, params.account.accountId);
  if (!(await readSignIn(path))) return null;
  const now = params.now ?? Date.now;

  // One refresh at a time: the token rotates, so two concurrent refreshes
  // would spend the same refresh token and the second would be refused.
  let refreshing: Promise<void> | null = null;
  const refresh = () =>
    (refreshing ??= (async () => {
      try {
        const current = await readSignIn(path);
        if (!current) throw new Error('The Pidgeon sign-in was removed. Sign in again.');
        const tokens = await exchange(
          current.baseUrl,
          {
            grant_type: 'refresh_token',
            refresh_token: current.refreshToken,
            client_id: current.clientId,
          },
          params.fetch,
        );
        await writeSignIn(
          path,
          storedFrom(current.baseUrl, current.clientId, tokens, current.refreshToken, now()),
        );
      } finally {
        refreshing = null;
      }
    })());

  return {
    kind: 'sign-in',
    source: path,
    token: async () => {
      let current = await readSignIn(path);
      if (!current) throw new Error('The Pidgeon sign-in was removed. Sign in again.');
      if (current.expiresAt - EARLY_MS <= now()) {
        await refresh();
        current = await readSignIn(path);
      }
      return current!.accessToken;
    },
    refresh,
  };
}

/**
 * Signs out: revokes the refresh token at Pidgeon, which ends the key the
 * consent made, then deletes the file. The file goes even when Pidgeon cannot
 * be reached, so `channels logout` never leaves a sign-in behind; the key then
 * expires on its own after thirty days unused, or Disconnect ends it now.
 */
export async function signOut(
  path: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ removed: boolean; revoked: boolean }> {
  const current = await readSignIn(path);
  let revoked = false;
  if (current) {
    try {
      const response = await fetchImpl(`${current.baseUrl}/api/oauth/revoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          token: current.refreshToken,
          token_type_hint: 'refresh_token',
          client_id: current.clientId,
        }).toString(),
      });
      revoked = response.ok;
    } catch {
      revoked = false;
    }
  }
  return { removed: await removeSignIn(path), revoked };
}
