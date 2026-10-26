import { HttpMethod } from '@activepieces/pieces-common';
import { createTrigger, Property, TriggerStrategy } from '@activepieces/pieces-framework';
import { pidgeonAuth } from '../auth';
import { pidgeonRequest } from '../common/client';
import { Envelope, flatMessage } from '../common/mapping';
import { addressDropdown, bodyChoice } from '../common/props';
import { verifySignature } from '../common/signature';

const ENDPOINT = 'pidgeon_webhook';

interface Endpoint {
  id: string;
  secret: string;
}

/**
 * Starts a flow when mail arrives at an address.
 *
 * It makes its own webhook on Pidgeon when the flow is published and deletes
 * it when the flow is turned off, so nobody copies a URL or a secret. Every
 * delivery's signature is checked; one that is not Pidgeon's, or is more
 * than five minutes old, starts nothing.
 */
export const emailReceived = createTrigger({
  auth: pidgeonAuth,
  name: 'email_received',
  displayName: 'Email Received',
  description: 'Starts the flow when mail arrives at an address.',
  type: TriggerStrategy.WEBHOOK,
  props: {
    identity_id: addressDropdown({
      displayName: 'Address',
      description: 'The address to watch. One address per trigger, and a key that reaches only it.',
      required: true,
      value: 'id',
    }),
    include_spam: Property.Checkbox({
      displayName: 'Include Spam',
      description: 'Whether to start the flow for mail filed as spam too.',
      required: false,
      defaultValue: false,
    }),
    body: bodyChoice,
  },
  sampleData: {
    event: 'message.received',
    event_id: '0044ed22-5f0e-4b8e-9a43-7c1d2b6f9e10',
    message_id: '1a70b25d-8c3e-4f1a-b2d4-6e9f0a1b2c3d',
    thread_id: '463ec73a-2b1d-4e5f-8a9b-0c1d2e3f4a5b',
    address: 'quotes@acme.pidgeon.email',
    from: 'priya@supplier.de',
    from_name: 'Priya Raman',
    to: ['quotes@acme.pidgeon.email'],
    cc: [],
    delivered_to: 'quotes@acme.pidgeon.email',
    subject: 'Angebot 4471',
    received_at: '2026-10-25T09:14:03Z',
    spam: false,
    from_self: false,
    bcc_to_this_address: false,
    firewall_verdict: 'clean',
    firewall_signals: [],
    auth_spf: 'pass',
    auth_dkim: 'pass',
    auth_dmarc: 'pass',
    is_reply: false,
    thread_status: 'open',
    thread_owner_type: 'agent',
    thread_assignee_id: null,
    text: 'Guten Tag, anbei unser Angebot …',
    reply_text: 'Guten Tag, anbei unser Angebot …',
    codes: [],
    links: [],
    attachments: [
      {
        id: '0b1d4e8c-7a6f-4e3d-9c2b-1a0f9e8d7c6b',
        filename: 'angebot.pdf',
        content_type: 'application/pdf',
        size: 48211,
      },
    ],
    test: false,
  },

  async onEnable(context) {
    const created = await pidgeonRequest<{ id: string; secret: string }>({
      key: context.auth.secret_text,
      method: HttpMethod.POST,
      path: '/webhooks',
      body: {
        url: context.webhookUrl,
        identity_id: context.propsValue.identity_id,
        event_types: context.propsValue.include_spam
          ? ['message.received', 'message.spam']
          : ['message.received'],
      },
    });
    // The secret is returned once, here, and never shown to anybody.
    await context.store.put<Endpoint>(ENDPOINT, {
      id: String(created.data.id),
      secret: String(created.data.secret),
    });
  },

  async onDisable(context) {
    const endpoint = await context.store.get<Endpoint>(ENDPOINT);
    if (endpoint) {
      await pidgeonRequest({
        key: context.auth.secret_text,
        method: HttpMethod.DELETE,
        path: `/webhooks/${endpoint.id}`,
        allowNotFound: true,
      });
      await context.store.delete(ENDPOINT);
    }
  },

  // The newest message at the address, so the data panel shows real fields.
  async test(context) {
    const found = await pidgeonRequest<Array<{ id: string; thread_id?: string }>>({
      key: context.auth.secret_text,
      method: HttpMethod.GET,
      path: '/messages/search',
      query: { identity_id: context.propsValue.identity_id, in: 'inbox', limit: 1 },
    });
    const newest = found.data?.[0];
    if (!newest) return [];
    return [await read(context.auth.secret_text, newest.id, newest.thread_id, context.propsValue.body)];
  },

  async run(context) {
    const endpoint = await context.store.get<Endpoint>(ENDPOINT);
    const signed =
      endpoint !== null &&
      verifySignature({
        secret: endpoint.secret,
        headers: context.payload.headers,
        rawBody: context.payload.rawBody,
      });
    if (!signed) return [];

    const envelope = (
      typeof context.payload.rawBody === 'string' ? JSON.parse(context.payload.rawBody) : context.payload.body
    ) as Envelope;
    if (envelope.type !== 'message.received' && envelope.type !== 'message.spam') return [];

    const messageId = envelope.data['message_id'] as string | undefined;
    // A routed delivery is not stored, so there is nothing to read: its body came with it.
    if (envelope.data['stored'] === false || !messageId) return [flatMessage({ envelope })];

    return [
      await read(
        context.auth.secret_text,
        messageId,
        envelope.data['thread_id'] as string | undefined,
        context.propsValue.body,
        envelope,
      ),
    ];
  },
});

/**
 * Pidgeon's webhooks carry ids and metadata, never a body, so the trigger
 * reads the message and its thread before the flow starts.
 */
async function read(
  key: string,
  messageId: string,
  threadId: string | undefined,
  body: string,
  envelope?: Envelope,
): Promise<Record<string, unknown>> {
  const message = await pidgeonRequest<Record<string, unknown>>({
    key,
    method: HttpMethod.GET,
    path: `/messages/${encodeURIComponent(messageId)}`,
    query: { body },
  });
  const thread = threadId
    ? await pidgeonRequest<Record<string, unknown> | null>({
        key,
        method: HttpMethod.GET,
        path: `/threads/${encodeURIComponent(threadId)}`,
        allowNotFound: true,
      })
    : undefined;
  return flatMessage({ envelope, message: message.data, thread: thread?.data ?? undefined });
}
