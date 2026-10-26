/**
 * The piece against production Pidgeon, through Activepieces' own framework
 * and HTTP client. Skipped without `PIDGEON_ADMIN_KEY`.
 *
 * The admin key creates the address (through Create Address) and a test
 * key for it; everything after runs on the test key, so nothing sent leaves
 * Pidgeon. Both are deleted at the end.
 *
 * The trigger's webhook points at a URL nobody answers: what is proved is
 * that it makes and deletes its own endpoint, and that a real event, signed
 * with that endpoint's real secret, becomes the flow's item. Delivery over
 * the network is Pidgeon's, tested on Pidgeon's side.
 */
import { randomBytes } from 'node:crypto';
import { createMockActionContext } from '@activepieces/pieces-framework';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createAddress } from '../src/lib/actions/create-address';
import { replyToEmail } from '../src/lib/actions/reply';
import { searchEmails } from '../src/lib/actions/search-emails';
import { updateThread } from '../src/lib/actions/update-thread';
import { waitForCode } from '../src/lib/actions/wait-for-code';
import { pidgeonAuth } from '../src/lib/auth';
import { sign } from '../src/lib/common/signature';
import { emailReceived } from '../src/lib/triggers/email-received';

const API = 'https://pidgeon.ai/api/v1';
const ADMIN = process.env['PIDGEON_ADMIN_KEY'];
const marker = randomBytes(3).toString('hex');

type Json = Record<string, any>;

async function pidgeon(key: string, method: string, path: string, body?: unknown): Promise<Json> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

function context(key: string, propsValue: Json, extra: Json = {}) {
  return {
    ...createMockActionContext({ propsValue: propsValue as never }),
    auth: { type: 'SECRET_TEXT', secret_text: key },
    run: { id: `live-${marker}` },
    step: { name: `step-${randomBytes(4).toString('hex')}` },
    ...extra,
  } as never;
}

describe.skipIf(!ADMIN)('the piece against production', () => {
  let address: Json;
  let testKey: { id: string; token: string };
  const store = new Map<string, unknown>();
  const triggerContext = (payload?: unknown) =>
    context(testKey.token, { identity_id: address['id'], include_spam: false, body: 'clean' }, {
      webhookUrl: `https://example.com/activepieces-e2e/${marker}`,
      payload,
      store: {
        put: async (name: string, value: unknown) => (store.set(name, value), value),
        get: async (name: string) => store.get(name) ?? null,
        delete: async (name: string) => void store.delete(name),
      },
    });

  beforeAll(async () => {
    // Old runs that died before their cleanup.
    const existing = (await pidgeon(ADMIN!, 'GET', '/identities?limit=200')).data as Json[];
    for (const stale of existing.filter((entry) => String(entry['email']).startsWith('activepieces-e2e-'))) {
      if (Date.now() - Date.parse(stale['created_at']) > 60 * 60 * 1000) {
        await pidgeon(ADMIN!, 'DELETE', `/identities/${stale['id']}`).catch(() => undefined);
      }
    }

    address = (await createAddress.run(
      context(ADMIN!, {
        address: `activepieces-e2e-${marker}@pidgeon.email`,
        type: 'workflow',
        send_policy: 'reply_only',
        inbox: true,
      }),
    )) as Json;
    testKey = (
      await pidgeon(ADMIN!, 'POST', '/api-keys', {
        name: 'Activepieces e2e',
        access: 'send',
        identity_ids: [address['id']],
        test: true,
      })
    ).data;
  }, 60_000);

  afterAll(async () => {
    if (testKey) await pidgeon(ADMIN!, 'DELETE', `/api-keys/${testKey.id}`).catch(() => undefined);
    if (address) await pidgeon(ADMIN!, 'DELETE', `/identities/${address['id']}`).catch(() => undefined);
  }, 60_000);

  test('the connection accepts the test key', async () => {
    expect(await pidgeonAuth.validate!({ auth: testKey.token, server: {} as never })).toEqual({ valid: true });
    expect((await pidgeonAuth.validate!({ auth: 'pgn_test_nonsense', server: {} as never })).valid).toBe(false);
  });

  test('mail in, code read, trigger item, reply, hand-off, search', async () => {
    await emailReceived.onEnable(triggerContext());
    const endpoint = store.get('pidgeon_webhook') as { id: string; secret: string };
    expect(endpoint.id).toBeTruthy();
    const webhook = (await pidgeon(testKey.token, 'GET', `/webhooks/${endpoint.id}`)).data;
    expect(webhook).toMatchObject({ url: `https://example.com/activepieces-e2e/${marker}` });

    // Waiting first, as a sign-up flow does: the code arrives while the step holds.
    const waiting = waitForCode.run(context(testKey.token, { identity_id: address['id'], timeout: 60, body: 'clean' }));
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const delivered = (
      await pidgeon(testKey.token, 'POST', '/test/inbound', {
        to: address['email'],
        from: 'priya@supplier.example',
        from_name: 'Priya Raman',
        subject: `Angebot ${marker}`,
        text: 'Guten Tag, anbei unser Angebot. Ihr Code: 482910.',
      })
    ).data;
    const awaited = (await waiting) as Json;
    expect(awaited).toMatchObject({ timed_out: false, code: '482910', message_id: delivered.message_id });

    // The event Pidgeon delivered, signed with the endpoint's own secret.
    let envelope: Json | undefined;
    for (let attempt = 0; attempt < 20 && !envelope; attempt++) {
      const events = (
        await pidgeon(testKey.token, 'GET', `/events?type=message.received&identity_id=${address['id']}&limit=10`)
      ).data as Json[];
      const event = events.find(
        (entry) => (entry['message_id'] ?? entry['data']?.['message_id']) === delivered.message_id,
      );
      // A webhook delivers `{ id, type, created_at, data }`, with the ids in `data`.
      if (event) {
        envelope = {
          id: event['id'],
          type: event['type'],
          created_at: event['created_at'],
          data: { message_id: event['message_id'], thread_id: event['thread_id'], identity: event['identity'], ...event['data'] },
        };
      }
      if (!envelope) await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    expect(envelope).toBeTruthy();
    const raw = JSON.stringify(envelope);
    const now = Math.floor(Date.now() / 1000);
    const items = (await emailReceived.run(
      triggerContext({
        body: envelope,
        rawBody: raw,
        headers: { 'x-pidgeon-signature': sign(endpoint.secret, now, raw), 'x-pidgeon-timestamp': String(now) },
      }),
    )) as Json[];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      event: 'message.received',
      message_id: delivered.message_id,
      from: 'priya@supplier.example',
      subject: `Angebot ${marker}`,
      codes: ['482910'],
      test: true,
    });
    const forged = (await emailReceived.run(
      triggerContext({
        body: envelope,
        rawBody: raw,
        headers: { 'x-pidgeon-signature': sign('not-the-secret', now, raw), 'x-pidgeon-timestamp': String(now) },
      }),
    )) as Json[];
    expect(forged).toEqual([]);

    const reply = (await replyToEmail.run(
      context(testKey.token, { message_id: delivered.message_id, text: `Danke ${marker}` }),
    )) as Json;
    expect(reply['id']).toBeTruthy();

    const thread = (await updateThread.run(
      context(testKey.token, { thread_id: items[0]['thread_id'], owner: 'human', reason: 'Needs a price' }),
    )) as Json;
    expect(thread['owner_type']).toBe('human');

    const found = (await searchEmails.run(
      context(testKey.token, { q: marker, identity_id: address['id'], limit: 10 }),
    )) as { messages: Json[] };
    expect(found.messages.some((message) => message['id'] === delivered.message_id)).toBe(true);

    await emailReceived.onDisable(triggerContext());
    const gone = await fetch(`${API}/webhooks/${endpoint.id}`, {
      headers: { Authorization: `Bearer ${testKey.token}` },
    });
    expect(gone.status).toBe(404);
  }, 120_000);
});
