/**
 * The Pidgeon channel as OpenClaw sees it: accounts, sign-in, the Gateway
 * lifecycle, status, and outbound replies.
 *
 * Email here is reply-only. A turn answers the message that started it, in
 * its thread; the `message` tool can answer any message by
 * `message:<id>`, and cannot address a stranger or start a new thread. A
 * channel that could would let a prompt in one email send mail anywhere.
 */
import type { ChannelGatewayContext } from 'openclaw/plugin-sdk/channel-contract';
import { createChatChannelPlugin, type ChannelPlugin } from 'openclaw/plugin-sdk/channel-core';

import {
  CHANNEL_ID,
  defaultAccountId,
  listAccountIds,
  resolveAccount,
  type ResolvedAccount,
} from './config.js';
import { readSignIn, signInPath, signOut, writeSignIn } from './credentials.js';
import { plainEmailText } from './gate.js';
import { signIn } from './login.js';
import { clientFor, sendReply, startAccount } from './monitor.js';
import { getRuntime } from './runtime.js';

const TARGET = /^message:([0-9a-f-]{36})$/i;

export function normalizeTarget(raw: string): string | null {
  const match = TARGET.exec(raw.trim());
  return match ? `message:${match[1]!.toLowerCase()}` : null;
}

async function signedIn(account: ResolvedAccount): Promise<boolean> {
  return Boolean(
    await readSignIn(signInPath(getRuntime().state.resolveStateDir(), account.accountId)),
  );
}

function keyPresent(account: ResolvedAccount): boolean {
  return Boolean(process.env[account.apiKeyEnv]?.trim());
}

export const pidgeonPlugin: ChannelPlugin<ResolvedAccount> =
  createChatChannelPlugin<ResolvedAccount>({
    base: {
      id: CHANNEL_ID,
      meta: {
        id: CHANNEL_ID,
        label: 'Pidgeon',
        selectionLabel: 'Pidgeon (Email)',
        detailLabel: 'Pidgeon Email',
        docsPath: 'https://pidgeon.ai/docs/openclaw',
        docsLabel: 'pidgeon',
        blurb:
          "Email to your agent's own address starts or continues a conversation; replies go back in the thread.",
      },
      capabilities: {
        chatTypes: ['direct'],
        threads: true,
        reply: true,
        media: false,
        reactions: false,
        edit: false,
        unsend: false,
        effects: false,
        blockStreaming: true,
      },
      reload: { configPrefixes: [`channels.${CHANNEL_ID}`] },
      config: {
        listAccountIds: (cfg: unknown) => listAccountIds(cfg),
        resolveAccount: (cfg: unknown, accountId?: string | null) => resolveAccount(cfg, accountId),
        defaultAccountId: (cfg: unknown) => defaultAccountId(cfg),
        inspectAccount: (cfg: unknown, accountId?: string | null) => {
          const account = resolveAccount(cfg, accountId);
          return {
            enabled: account.present && account.enabled,
            configured: account.present,
            apiCredentialStatus: keyPresent(account) ? 'available' : 'missing',
          };
        },
        isConfigured: (account: ResolvedAccount) => account.present,
        // What the Gateway asks before it starts an account, and again when
        // `channels login` hands a fresh sign-in to a running Gateway.
        isLinked: async (account: ResolvedAccount) =>
          keyPresent(account) || (await signedIn(account)) ? 'linked' : 'not-linked',
        isEnabled: (account: ResolvedAccount) => account.present && account.enabled,
        unconfiguredReason: () =>
          'Add `channels.pidgeon` to openclaw.json, then sign in with `openclaw channels login --channel pidgeon`, or give the Gateway an API key in PIDGEON_API_KEY.',
        describeAccount: (account: ResolvedAccount) => ({
          accountId: account.accountId,
          name: account.name,
          enabled: account.enabled,
          configured: account.present,
        }),
      },
      auth: {
        login: async ({
          cfg,
          accountId,
          runtime,
        }: {
          cfg: unknown;
          accountId?: string | null;
          runtime: { log: (...args: unknown[]) => void };
        }) => {
          const account = resolveAccount(cfg, accountId);
          runtime.log(
            `Signing in to Pidgeon for the "${account.accountId}" account. Open this link, choose the access and the addresses, and allow it (the link works for ten minutes):`,
          );
          const stored = await signIn({
            baseUrl: account.baseUrl,
            announce: (url) => runtime.log(`\n  ${url}\n`),
          });
          const path = signInPath(getRuntime().state.resolveStateDir(), account.accountId);
          await writeSignIn(path, stored);
          runtime.log(`Signed in. Saved to ${path}, readable by you only.`);
        },
      },
      gateway: {
        startAccount: (ctx: ChannelGatewayContext<ResolvedAccount>) => startAccount(ctx),
        logoutAccount: async ({ account }: { account: ResolvedAccount }) => {
          const result = await signOut(
            signInPath(getRuntime().state.resolveStateDir(), account.accountId),
          );
          return { cleared: result.removed, loggedOut: result.removed, revoked: result.revoked };
        },
      },
      status: {
        // The runtime snapshot is what the running account published, so this
        // reports what is true now, not what the config hopes for.
        buildAccountSnapshot: async ({
          account,
          runtime,
        }: {
          account: ResolvedAccount;
          runtime?: Record<string, unknown>;
        }) => ({
          ...runtime,
          accountId: account.accountId,
          name: account.name,
          enabled: account.enabled,
          configured: account.present,
          apiCredentialStatus:
            keyPresent(account) || (await signedIn(account)) ? 'available' : 'missing',
        }),
        probeAccount: async ({ account }: { account: ResolvedAccount }) => {
          const opened = await clientFor(account);
          if (!opened.client) return { ok: false, error: opened.reason };
          try {
            const me = await opened.client.me();
            return { ok: true, workspace: me.workspace?.name ?? null };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : String(error) };
          }
        },
      },
      messaging: {
        targetPrefixes: ['message'],
        normalizeTarget: (raw: string) => normalizeTarget(raw) ?? undefined,
        targetResolver: {
          looksLikeId: (value: string) => normalizeTarget(value) !== null,
          hint: 'message:<messageId>',
        },
      },
      agentPrompt: {
        // Email reaches people in mail clients that show Markdown as literal
        // asterisks: the answer is written as a plain-text email.
        inboundFormattingHints: () => ({
          text_markup: 'plain_text',
          rules: [
            'You are writing an email. Plain text only: no Markdown, no **bold**, no headings, no tables.',
            'Write it as a person would: a greeting when it fits, short paragraphs, and lists with a hyphen or a number.',
          ],
        }),
        messageToolHints: () => [
          '',
          '### Email through Pidgeon',
          'Your answer to an email is sent as a reply in its thread. To answer another email, use its message:<messageId> target. You cannot write to a new recipient or start a new thread from here.',
        ],
      },
    },
    outbound: {
      deliveryMode: 'gateway',
      resolveTarget: ({ to }: { to?: string }) => {
        const target = to ? normalizeTarget(to) : null;
        return target
          ? { ok: true, to: target }
          : {
              ok: false,
              error: new Error(
                'A Pidgeon target is message:<messageId>, the email being answered. New recipients and new threads are not supported.',
              ),
            };
      },
      sendText: async ({
        cfg,
        to,
        text,
        accountId,
      }: {
        cfg: unknown;
        to: string;
        text: string;
        accountId?: string | null;
      }) => {
        const account = resolveAccount(cfg, accountId);
        const target = normalizeTarget(to);
        if (!target) throw new Error(`Not a Pidgeon target: ${to}`);
        const opened = await clientFor(account);
        if (!opened.client) throw new Error(opened.reason);
        const sent = await sendReply({
          client: opened.client,
          accountId: account.accountId,
          messageId: target.slice('message:'.length),
          text: plainEmailText(text),
        });
        return { channel: CHANNEL_ID, messageId: sent.id };
      },
    },
  });
