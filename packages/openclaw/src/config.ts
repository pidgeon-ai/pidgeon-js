/**
 * `channels.pidgeon` in `openclaw.json`, resolved to one account.
 *
 * Top-level fields are the default account and the defaults every named
 * account under `accounts` inherits. No credential is ever read from here:
 * the key comes from the Gateway's environment (`apiKeyEnv`), and a sign-in
 * is stored by `openclaw channels login --channel pidgeon` outside the config.
 */

export const CHANNEL_ID = 'pidgeon';
export const DEFAULT_ACCOUNT_ID = 'default';
export const DEFAULT_BASE_URL = 'https://pidgeon.ai';
export const DEFAULT_KEY_ENV = 'PIDGEON_API_KEY';
export const DEFAULT_POLL_SECONDS = 5;

export type DmPolicy = 'open' | 'allowlist' | 'disabled';

export interface AccountConfig {
  enabled?: boolean;
  name?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  addresses?: string[];
  dmPolicy?: DmPolicy;
  allowFrom?: string[];
  allowUnauthenticated?: boolean;
  suspicious?: 'hold' | 'deliver';
  pollSeconds?: number;
}

interface ChannelSection extends AccountConfig {
  accounts?: Record<string, AccountConfig>;
  defaultAccount?: string;
}

export interface ResolvedAccount {
  accountId: string;
  name: string;
  enabled: boolean;
  /** Present in the config at all, which is what turns the channel on. */
  present: boolean;
  baseUrl: string;
  apiKeyEnv: string;
  /** Lowercased; empty means every address the credential reaches. */
  addresses: string[];
  dmPolicy: DmPolicy;
  /** Lowercased addresses and `@domain` entries. */
  allowFrom: string[];
  /** Trust an allowlisted From that did not pass DMARC. Off: a From is forgeable. */
  allowUnauthenticated: boolean;
  suspicious: 'hold' | 'deliver';
  pollSeconds: number;
}

function section(cfg: unknown): ChannelSection | undefined {
  const channels = (cfg as { channels?: Record<string, unknown> } | undefined)?.channels;
  const value = channels?.[CHANNEL_ID];
  return value && typeof value === 'object' ? (value as ChannelSection) : undefined;
}

/**
 * `default`, or the named accounts when there are any. With named accounts
 * the top-level fields are only what they inherit: listing them as an
 * account too would start a second consumer of the same mail.
 */
export function listAccountIds(cfg: unknown): string[] {
  const named = Object.keys(section(cfg)?.accounts ?? {});
  return named.length > 0 ? named : [DEFAULT_ACCOUNT_ID];
}

export function defaultAccountId(cfg: unknown): string {
  return section(cfg)?.defaultAccount ?? listAccountIds(cfg)[0] ?? DEFAULT_ACCOUNT_ID;
}

const lower = (values: string[] | undefined) =>
  (values ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean);

export function resolveAccount(cfg: unknown, accountId?: string | null): ResolvedAccount {
  const id = accountId || defaultAccountId(cfg);
  const top = section(cfg);
  const { accounts, defaultAccount: _default, ...inherited } = top ?? {};
  const merged: AccountConfig = { ...inherited, ...accounts?.[id] };
  const poll = merged.pollSeconds ?? DEFAULT_POLL_SECONDS;

  return {
    accountId: id,
    name: merged.name ?? (id === DEFAULT_ACCOUNT_ID ? 'Pidgeon' : id),
    enabled: merged.enabled !== false,
    present: Boolean(top),
    baseUrl: (merged.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, ''),
    apiKeyEnv: merged.apiKeyEnv ?? DEFAULT_KEY_ENV,
    addresses: lower(merged.addresses),
    dmPolicy: merged.dmPolicy ?? 'open',
    allowFrom: lower(merged.allowFrom),
    allowUnauthenticated: merged.allowUnauthenticated === true,
    suspicious: merged.suspicious ?? 'hold',
    pollSeconds: Math.min(300, Math.max(2, Math.round(poll))),
  };
}
