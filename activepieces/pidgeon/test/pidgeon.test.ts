import { HttpError, HttpMethod, httpClient } from '@activepieces/pieces-common';
import { createMockActionContext } from '@activepieces/pieces-framework';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createAddress } from '../src/lib/actions/create-address';
import { replyToEmail } from '../src/lib/actions/reply';
import { searchEmails } from '../src/lib/actions/search-emails';
import { sendEmail } from '../src/lib/actions/send-email';
import { updateThread } from '../src/lib/actions/update-thread';
import { waitForCode } from '../src/lib/actions/wait-for-code';
import { pidgeonAuth } from '../src/lib/auth';
import { sign } from '../src/lib/common/signature';
import { emailReceived } from '../src/lib/triggers/email-received';

const KEY = 'pgn_test_abc';
const auth = { type: 'SECRET_TEXT', secret_text: KEY };

interface Sent {
  method: string;
  url: string;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  timeout?: number;
  token?: string;
}

let sent: Sent[];
let answer: (request: Sent) => unknown;

beforeEach(() => {
  sent = [];
  answer = () => ({ data: {} });
  vi.spyOn(httpClient, 'sendRequest').mockImplementation(async (request) => {
    const entry: Sent = {
      method: request.method,
      url: request.url,
      body: request.body as Record<string, unknown> | undefined,
      headers: request.headers as Record<string, string> | undefined,
      queryParams: request.queryParams as Record<string, string> | undefined,
      timeout: request.timeout,
      token: (request.authentication as { token?: string } | undefined)?.token,
    };
    sent.push(entry);
    const body = answer(entry);
    if (body instanceof HttpError) throw body;
    return { status: 200, headers: {}, body } as never;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function context<P>(propsValue: P, extra: Record<string, unknown> = {}) {
  return { ...createMockActionContext({ propsValue: propsValue as never }), auth, ...extra } as never;
}

describe('the connection', () => {
  test('is checked against GET /me with the key as a bearer token', async () => {
    const result = await pidgeonAuth.validate!({ auth: KEY, server: {} as never });
    expect(result).toEqual({ valid: true });
    expect(sent[0]).toMatchObject({ method: HttpMethod.GET, url: 'https://pidgeon.ai/api/v1/me', token: KEY });
  });

  test('says what Pidgeon said when the key is refused', async () => {
    answer = () =>
      new HttpError(undefined, {
        status: 401,
        responseBody: { error: { code: 'invalid_key', message: 'This key has been revoked.' } },
      });
    const result = await pidgeonAuth.validate!({ auth: 'pgn_live_old', server: {} as never });
    expect(result).toEqual({
      valid: false,
      error: 'Pidgeon answered 401: This key has been revoked. (invalid_key)',
    });
  });
});

describe('Send Email', () => {
  const props = {
    from: 'quotes@acme.pidgeon.email',
    to: 'priya@supplier.de, ops@acme.com',
    subject: 'Angebot 4471',
    text: 'Danke, wir melden uns.',
    cc: 'boss@acme.com',
  };

  test('posts one message with the recipients as a list', async () => {
    await sendEmail.run(context(props));
    expect(sent[0]).toMatchObject({
      method: HttpMethod.POST,
      url: 'https://pidgeon.ai/api/v1/messages',
      body: {
        from: 'quotes@acme.pidgeon.email',
        to: ['priya@supplier.de', 'ops@acme.com'],
        cc: ['boss@acme.com'],
        subject: 'Angebot 4471',
        text: 'Danke, wir melden uns.',
      },
    });
    expect(sent[0].body).not.toHaveProperty('bcc');
  });

  test('a retry of the same step sends once, and a different message is a different send', async () => {
    await sendEmail.run(context(props));
    await sendEmail.run(context(props));
    await sendEmail.run(context({ ...props, to: 'someone@else.com' }));
    const keys = sent.map((request) => request.headers?.['Idempotency-Key']);
    expect(keys[0]).toMatch(/^activepieces-[0-9a-f]{64}$/);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  test('refuses to send to nobody', async () => {
    await expect(sendEmail.run(context({ ...props, to: ' , ' }))).rejects.toThrow('Name somebody to send to.');
    expect(sent).toHaveLength(0);
  });
});

describe('Reply to Email', () => {
  test('replies in the thread by message id', async () => {
    await replyToEmail.run(context({ message_id: ' 1a70b25d ', text: 'Danke!' }));
    expect(sent[0]).toMatchObject({
      method: HttpMethod.POST,
      url: 'https://pidgeon.ai/api/v1/messages/1a70b25d/reply',
      body: { text: 'Danke!' },
    });
    expect(sent[0].headers?.['Idempotency-Key']).toMatch(/^activepieces-/);
  });
});

describe('Update Thread', () => {
  test('hands a thread to a person, to nobody in particular', async () => {
    await updateThread.run(context({ thread_id: '463ec73a', owner: 'human', reason: 'Needs a price' }));
    expect(sent[0]).toMatchObject({
      method: HttpMethod.PATCH,
      url: 'https://pidgeon.ai/api/v1/threads/463ec73a',
      body: { owner_type: 'human', assignee_id: null, reason: 'Needs a price' },
    });
  });

  test('gives it back to the agent without an assignee', async () => {
    await updateThread.run(context({ thread_id: '463ec73a', owner: 'agent', assignee_id: 'm1' }));
    expect(sent[0].body).toEqual({ owner_type: 'agent' });
  });

  test('changes the status alone', async () => {
    await updateThread.run(context({ thread_id: '463ec73a', status: 'resolved' }));
    expect(sent[0].body).toEqual({ status: 'resolved' });
  });

  test('refuses a change that changes nothing', async () => {
    await expect(updateThread.run(context({ thread_id: '463ec73a' }))).rejects.toThrow(
      'Choose an owner or a status to change.',
    );
  });
});

describe('Create Address', () => {
  test('posts the address with its policy', async () => {
    answer = () => ({ data: { id: 'i1', email: 'quotes@acme.pidgeon.email' } });
    const created = await createAddress.run(
      context({ address: ' quotes@acme.pidgeon.email ', type: 'workflow', send_policy: 'reply_only', inbox: true }),
    );
    expect(created).toEqual({ id: 'i1', email: 'quotes@acme.pidgeon.email' });
    expect(sent[0]).toMatchObject({
      method: HttpMethod.POST,
      url: 'https://pidgeon.ai/api/v1/identities',
      body: { address: 'quotes@acme.pidgeon.email', type: 'workflow', send_policy: 'reply_only', inbox: true },
    });
  });
});

describe('Wait for Code', () => {
  test('waits for mail with a code, and the request outlives the wait', async () => {
    answer = () => ({
      data: {
        message: {
          id: 'm1',
          thread_id: 't1',
          from: { email: 'no-reply@github.com', name: 'GitHub' },
          to: [{ email: 'signup@acme.pidgeon.email' }],
          subject: 'Your code',
          extracted: { codes: [{ value: '482910' }], links: [] },
        },
        timed_out: false,
        cursor: 'c1',
      },
    });
    const result = (await waitForCode.run(
      context({ identity_id: 'i1', timeout: 600, from: 'no-reply@github.com', body: 'clean' }),
    )) as Record<string, unknown>;

    expect(sent[0].url).toBe('https://pidgeon.ai/api/v1/messages/await');
    expect(sent[0].queryParams).toEqual({
      identity_id: 'i1',
      timeout: '280',
      has_code: 'true',
      from: 'no-reply@github.com',
      body: 'clean',
    });
    expect(sent[0].timeout).toBe(310_000);
    expect(result).toMatchObject({ code: '482910', message_id: 'm1', from: 'no-reply@github.com', timed_out: false, cursor: 'c1' });
  });

  test('nothing arriving is an answer, not an error', async () => {
    answer = () => ({ data: { message: null, timed_out: true, cursor: 'c2' } });
    const result = await waitForCode.run(context({ identity_id: 'i1', timeout: 5, any_mail: true, body: 'clean' }));
    expect(sent[0].queryParams).not.toHaveProperty('has_code');
    expect(result).toEqual({ code: null, timed_out: true, cursor: 'c2', held_back: null });
  });
});

describe('Search Emails', () => {
  test('passes the folder as `in` and caps the limit', async () => {
    answer = () => ({ data: [{ id: 'm1' }], has_more: true });
    const result = await searchEmails.run(context({ q: 'Angebot', folder: 'inbox', limit: 500 }));
    expect(sent[0].queryParams).toEqual({ q: 'Angebot', in: 'inbox', limit: '100' });
    expect(result).toEqual({ messages: [{ id: 'm1' }], has_more: true });
  });
});

describe('Email Received', () => {
  const store = new Map<string, unknown>();
  const hookContext = (payload?: { body: unknown; rawBody?: unknown; headers: Record<string, string> }) =>
    ({
      auth,
      propsValue: { identity_id: 'i1', include_spam: false, body: 'clean' },
      webhookUrl: 'https://cloud.activepieces.com/api/v1/webhooks/flow1',
      payload,
      store: {
        put: async (key: string, value: unknown) => {
          store.set(key, value);
          return value;
        },
        get: async (key: string) => store.get(key) ?? null,
        delete: async (key: string) => {
          store.delete(key);
        },
      },
    }) as never;

  const envelope = {
    id: 'e1',
    type: 'message.received',
    created_at: '2026-10-25T09:14:03Z',
    data: { message_id: 'm1', thread_id: 't1', identity: 'quotes@acme.pidgeon.email', subject: 'Angebot 4471' },
  };
  const raw = JSON.stringify(envelope);

  function delivery(secret: string, at = Math.floor(Date.now() / 1000), body = raw) {
    return {
      body: JSON.parse(body),
      rawBody: body,
      headers: { 'x-pidgeon-signature': sign(secret, at, body), 'x-pidgeon-timestamp': String(at) },
    };
  }

  beforeEach(() => store.clear());

  test('makes its own webhook for the address, and keeps the secret', async () => {
    answer = () => ({ data: { id: 'w1', secret: 'whsec_1' } });
    await emailReceived.onEnable(hookContext());
    expect(sent[0]).toMatchObject({
      method: HttpMethod.POST,
      url: 'https://pidgeon.ai/api/v1/webhooks',
      body: {
        url: 'https://cloud.activepieces.com/api/v1/webhooks/flow1',
        identity_id: 'i1',
        event_types: ['message.received'],
      },
    });
    expect(store.get('pidgeon_webhook')).toEqual({ id: 'w1', secret: 'whsec_1' });
  });

  test('a signed delivery reads the message and its thread, and is one flat item', async () => {
    store.set('pidgeon_webhook', { id: 'w1', secret: 'whsec_1' });
    answer = (request) =>
      request.url.endsWith('/messages/m1')
        ? {
            data: {
              id: 'm1',
              thread_id: 't1',
              identity: 'quotes@acme.pidgeon.email',
              from: { email: 'priya@supplier.de', name: 'Priya Raman' },
              to: [{ email: 'quotes@acme.pidgeon.email' }],
              subject: 'Angebot 4471',
              text: 'Guten Tag',
              authentication: { spf: 'pass', dkim: 'pass', dmarc: 'pass' },
              firewall: { verdict: 'clean', signals: [] },
            },
          }
        : { data: { id: 't1', message_count: 1, status: 'open', owner_type: 'agent', assignee_id: null } };

    const items = (await emailReceived.run(hookContext(delivery('whsec_1')))) as Array<Record<string, unknown>>;

    expect(sent.map((request) => request.url)).toEqual([
      'https://pidgeon.ai/api/v1/messages/m1',
      'https://pidgeon.ai/api/v1/threads/t1',
    ]);
    expect(sent[0].queryParams).toEqual({ body: 'clean' });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      event: 'message.received',
      event_id: 'e1',
      message_id: 'm1',
      from: 'priya@supplier.de',
      from_name: 'Priya Raman',
      auth_dmarc: 'pass',
      firewall_verdict: 'clean',
      is_reply: false,
      thread_owner_type: 'agent',
      bcc_to_this_address: false,
      text: 'Guten Tag',
    });
  });

  test('a forged delivery starts nothing and reads nothing', async () => {
    store.set('pidgeon_webhook', { id: 'w1', secret: 'whsec_1' });
    expect(await emailReceived.run(hookContext(delivery('somebody-else')))).toEqual([]);
    expect(sent).toHaveLength(0);
  });

  test('a delivery more than five minutes old starts nothing', async () => {
    store.set('pidgeon_webhook', { id: 'w1', secret: 'whsec_1' });
    const old = Math.floor(Date.now() / 1000) - 301;
    expect(await emailReceived.run(hookContext(delivery('whsec_1', old)))).toEqual([]);
  });

  test('a body changed after signing starts nothing', async () => {
    store.set('pidgeon_webhook', { id: 'w1', secret: 'whsec_1' });
    const signed = delivery('whsec_1');
    signed.rawBody = raw.replace('m1', 'm2');
    expect(await emailReceived.run(hookContext(signed))).toEqual([]);
  });

  test('turning the flow off deletes the webhook', async () => {
    store.set('pidgeon_webhook', { id: 'w1', secret: 'whsec_1' });
    await emailReceived.onDisable(hookContext());
    expect(sent[0]).toMatchObject({ method: HttpMethod.DELETE, url: 'https://pidgeon.ai/api/v1/webhooks/w1' });
    expect(store.has('pidgeon_webhook')).toBe(false);
  });
});
