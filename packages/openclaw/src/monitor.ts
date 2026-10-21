/**
 * One account's life in the Gateway: poll Pidgeon, queue what arrives
 * durably, turn each message into an agent turn, send the reply.
 *
 * The shape is OpenClaw's own X channel, which polls a cursor too:
 * `createChannelIngressMonitor` over the account's ingress queue, a cursor in
 * the plugin state store, and `channel.inbound.dispatch` with the queue's
 * lifecycle bound to the reply, so a message is marked done only when core
 * has adopted its turn. A crash before that replays it; a crash after does
 * not answer it twice.
 */
import { createHash } from 'node:crypto';

import {
  bindIngressLifecycleToReplyOptions,
  createChannelIngressError,
  createChannelIngressMonitor,
} from 'openclaw/plugin-sdk/channel-outbound';
import type { ChannelGatewayContext } from 'openclaw/plugin-sdk/channel-contract';
import { buildAgentSessionKey, resolveAgentRoute } from 'openclaw/plugin-sdk/routing';

import { createClient, PidgeonApiError, type Client, type Event, type Message } from './api.js';
import { CHANNEL_ID, type ResolvedAccount } from './config.js';
import { resolveCredential } from './credentials.js';
import { bodyForAgent, decide, plainEmailText } from './gate.js';
import { defaultSleep, runPoller, type Cursor, type PollStatus } from './poll.js';
import { getRuntime } from './runtime.js';

const InvalidEvent = createChannelIngressError('InvalidPidgeonEvent');
const CREDENTIAL_RECHECK_MS = 10_000;

/** One session per email thread, whatever the agent's `dmScope`. */
export function conversationId(threadId: string): string {
  return `thread:${threadId}`;
}

export function sessionKeyFor(agentId: string, accountId: string, threadId: string): string {
  return buildAgentSessionKey({
    agentId,
    channel: CHANNEL_ID,
    accountId,
    peer: { kind: 'direct', id: conversationId(threadId) },
    // Forced: the default `main` scope would fold every sender into one session.
    dmScope: 'per-account-channel-peer',
  });
}

/** The same reply text to the same message is one email, however often it is retried. */
function idempotencyKey(accountId: string, messageId: string, text: string): string {
  const digest = createHash('sha256').update(text).digest('hex').slice(0, 32);
  return `openclaw:${accountId}:${messageId}:${digest}`;
}

export async function sendReply(params: {
  client: Client;
  accountId: string;
  messageId: string;
  text: string;
}): Promise<{ id: string; thread_id: string }> {
  return params.client.reply(
    params.messageId,
    params.text,
    idempotencyKey(params.accountId, params.messageId, params.text),
  );
}

/** A client for `account`, or `null` with the sentence that says why not. */
export async function clientFor(
  account: ResolvedAccount,
  signal?: AbortSignal,
): Promise<{ client: Client; source: string } | { client: null; reason: string }> {
  const credential = await resolveCredential({
    account,
    stateDir: getRuntime().state.resolveStateDir(),
  });
  if (!credential) {
    return {
      client: null,
      reason: `Not signed in to Pidgeon. Run \`openclaw channels login --channel pidgeon\`, or give the Gateway an API key in ${account.apiKeyEnv}.`,
    };
  }
  return {
    client: createClient({
      baseUrl: account.baseUrl,
      token: credential.token,
      onUnauthorized: credential.refresh,
      signal,
    }),
    source: credential.source,
  };
}

const STATE: Record<
  PollStatus['state'],
  'starting' | 'ready' | 'recovering' | 'blocked' | 'stopped'
> = {
  starting: 'starting',
  running: 'ready',
  degraded: 'recovering',
  unauthorized: 'blocked',
  stopped: 'stopped',
};

export async function startAccount(ctx: ChannelGatewayContext<ResolvedAccount>): Promise<void> {
  const core = getRuntime();
  const account = ctx.account;
  const log = ctx.log;
  const publish = (next: Record<string, unknown>) =>
    ctx.setStatus({ ...ctx.getStatus(), accountId: account.accountId, ...next });

  // Configured but no credential yet: say so, and look again every few
  // seconds, so `channels login` run while the Gateway is up takes effect
  // without a restart rather than leaving a channel that never starts.
  let opened = await clientFor(account, ctx.abortSignal);
  if (!opened.client) {
    log?.warn(`Pidgeon: ${opened.reason}`);
    publish({ running: false, lifecycle: 'blocked', lastError: opened.reason });
  }
  while (!opened.client && !ctx.abortSignal.aborted) {
    await defaultSleep(CREDENTIAL_RECHECK_MS, ctx.abortSignal);
    opened = await clientFor(account, ctx.abortSignal);
  }
  if (!opened.client) {
    publish({ lifecycle: 'stopped' });
    return;
  }
  const client = opened.client;
  publish({ credentialSource: opened.source });

  const cursor = core.state.openKeyedStore<Cursor>({
    namespace: 'pidgeon.cursor',
    maxEntries: 1_000,
    overflowPolicy: 'reject-new',
  });
  const queue = core.state.openChannelIngressQueue<string>({ accountId: account.accountId });
  let held = 0;

  const ingress = createChannelIngressMonitor({
    queue,
    inspect: (event: Event) =>
      event.message_id && event.thread_id
        ? { eventId: event.message_id, laneKey: event.thread_id }
        : null,
    payload: {
      storage: 'raw-event',
      version: 1,
      serialize: (event: Event) => JSON.stringify(event),
      deserialize: (value: string) => {
        const event = JSON.parse(value) as Event;
        if (!event?.message_id || !event.thread_id)
          throw new InvalidEvent('Invalid stored Pidgeon event');
        return event;
      },
      createClaimError: () => new InvalidEvent('A Pidgeon event changed after it was queued'),
    },
    pollIntervalMs: 1_000,
    retention: {
      completedMaxEntries: 2_000,
      completedTtlMs: 30 * 24 * 60 * 60 * 1000,
      failedMaxEntries: 1_000,
    },
    abortSignal: ctx.abortSignal,
    deliver: async (
      event: Event,
      lifecycle: Parameters<typeof bindIngressLifecycleToReplyOptions>[0],
    ) => {
      let message: Message;
      try {
        message = await client.message(event.message_id!);
      } catch (error) {
        // Gone (deleted, or moved out of reach): nothing to answer, ever.
        if (error instanceof PidgeonApiError && error.status === 404) return;
        throw error;
      }

      const decision = decide(account, message);
      if (!decision.deliver) {
        held++;
        log?.info(`Pidgeon: message ${message.id} not given to the agent: ${decision.reason}.`);
        publish({ heldMessages: held, lastHeldReason: decision.reason });
        return;
      }

      const cfg = ctx.cfg;
      const route = resolveAgentRoute({
        cfg,
        channel: CHANNEL_ID,
        accountId: account.accountId,
        peer: { kind: 'direct', id: conversationId(message.thread_id) },
      });
      const sessionKey = sessionKeyFor(route.agentId, account.accountId, message.thread_id);
      const body = bodyForAgent(message);
      const sender = message.from.email.toLowerCase();

      const ctxPayload = core.channel.inbound.buildContext({
        channel: CHANNEL_ID,
        accountId: account.accountId,
        messageId: message.id,
        timestamp: Date.parse(message.created_at),
        from: `pidgeon:${sender}`,
        sender: { id: sender, name: message.from.name ?? sender },
        conversation: {
          kind: 'direct',
          id: conversationId(message.thread_id),
          label: message.subject?.trim() || sender,
        },
        route: {
          agentId: route.agentId,
          accountId: account.accountId,
          routeSessionKey: sessionKey,
          dispatchSessionKey: sessionKey,
        },
        reply: { to: `message:${message.id}` },
        message: {
          body,
          rawBody: body,
          commandBody: (message.reply_text ?? message.text ?? '').trim(),
          bodyForAgent: body,
        },
        extra: { MessageSid: message.id, MessageThreadId: message.thread_id },
      });

      await core.channel.inbound.dispatch({
        cfg,
        channel: CHANNEL_ID,
        accountId: account.accountId,
        route: { agentId: route.agentId, sessionKey },
        ctxPayload,
        ...bindIngressLifecycleToReplyOptions(lifecycle),
        delivery: {
          // One email per turn: the final answer, not each streamed block.
          preparePayload: (payload: { text?: string }, info: { kind: string }) =>
            info.kind === 'final' ? payload : null,
          deliver: async (payload: { text?: string }) => {
            const text = plainEmailText(payload.text ?? '');
            if (!text) return { visibleReplySent: false };
            await sendReply({ client, accountId: account.accountId, messageId: message.id, text });
            publish({ lastOutboundAt: Date.now() });
            return { visibleReplySent: true };
          },
        },
      });
    },
    // Only a first admission is new mail: the poll re-reads a window behind
    // its cursor, and a repeat must not read as "in: just now".
    onDurableAdmission: (_event: Event, context: { isNew: boolean }) => {
      if (context.isNew) publish({ lastInboundAt: Date.now() });
    },
    onError: () => log?.warn('Pidgeon: a queued message failed; it will be retried.'),
    drain: {
      resolveNonRetryableFailure: (error: unknown) =>
        error instanceof InvalidEvent
          ? { reason: 'invalid-event', message: (error as Error).message }
          : null,
    },
  });

  ingress.start();
  try {
    await runPoller({
      client,
      getCursor: async () => (await cursor.lookup(account.accountId)) ?? undefined,
      setCursor: (next) => cursor.register(account.accountId, next),
      admit: async (event) => {
        await ingress.admit(event);
      },
      addresses: account.addresses,
      intervalMs: account.pollSeconds * 1000,
      signal: ctx.abortSignal,
      log: { info: (line) => log?.info(line), warn: (line) => log?.warn(line) },
      onStatus: (status) =>
        publish({
          running: status.state !== 'stopped',
          connected: status.state === 'running',
          lifecycle: STATE[status.state],
          lastError: status.lastError ?? null,
          lastPollAt: status.lastPollAt ?? null,
          mode: 'poll',
        }),
    });
  } finally {
    await ingress.stop();
    publish({ running: false, connected: false, lifecycle: 'stopped' });
  }
}
