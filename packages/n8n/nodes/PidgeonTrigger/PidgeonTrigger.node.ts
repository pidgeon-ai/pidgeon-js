import {
  NodeConnectionTypes,
  NodeOperationError,
  type IDataObject,
  type IHookFunctions,
  type INodeType,
  type INodeTypeDescription,
  type IWebhookFunctions,
  type IWebhookResponseData,
} from 'n8n-workflow';

import { getInboxes } from '../shared/loadOptions';
import { verifySignature } from '../shared/signature';
import { pidgeonRequest } from '../shared/transport';

/** The events a workflow starts on; Pidgeon's webhooks carry more, listed in its docs. */
const EVENTS = [
  { name: 'Message Received', value: 'message.received', description: 'Mail arrived' },
  {
    name: 'Message Held',
    value: 'message.held',
    description: 'Suspicious mail waits for a person before the agent sees it',
  },
  { name: 'Message Sent', value: 'message.sent', description: 'Mail left an inbox' },
  { name: 'Message Delivered', value: 'message.delivered', description: 'The receiver took it' },
  { name: 'Message Bounced', value: 'message.bounced', description: 'The receiver refused it' },
  {
    name: 'Draft Approval Requested',
    value: 'draft.approval_requested',
    description: 'A draft waits for a person to send or reject it',
  },
  { name: 'Draft Approved', value: 'draft.approved', description: 'A person sent a draft' },
  { name: 'Draft Rejected', value: 'draft.rejected', description: 'A person rejected a draft' },
];

/**
 * Pidgeon's trigger. It makes its own webhook on Pidgeon when the workflow
 * starts listening and removes it when it stops, so nobody copies a URL or
 * a secret. n8n listens on two URLs, the editor's test URL and the
 * published one, so each gets its own webhook and secret, kept by URL.
 */
export class PidgeonTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Pidgeon Trigger',
    name: 'pidgeonTrigger',
    icon: { light: 'file:../../icons/pidgeon.svg', dark: 'file:../../icons/pidgeon.dark.svg' },
    group: ['trigger'],
    version: 1,
    subtitle: '={{$parameter["events"].join(", ")}}',
    description: 'Starts the workflow when mail arrives in an inbox, or a draft waits for a person',
    defaults: {
      name: 'Pidgeon Trigger',
    },
    inputs: [],
    outputs: [NodeConnectionTypes.Main],
    credentials: [{ name: 'pidgeonApi', required: true }],
    webhooks: [
      {
        name: 'default',
        httpMethod: 'POST',
        responseMode: 'onReceived',
        path: 'webhook',
      },
    ],
    properties: [
      {
        displayName:
          'The trigger makes a webhook on Pidgeon, which needs an admin key of the whole account, and an n8n Pidgeon can reach at a public https:// address',
        name: 'notice',
        type: 'notice',
        default: '',
      },
      {
        displayName: 'Events',
        name: 'events',
        type: 'multiOptions',
        required: true,
        options: EVENTS,
        default: ['message.received'],
      },
      {
        displayName: 'Inbox Names or IDs',
        name: 'inboxIds',
        type: 'multiOptions',
        typeOptions: { loadOptionsMethod: 'getInboxes' },
        default: [],
        description:
          'Only these inboxes’ events; every inbox of the account when empty. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
      },
      {
        displayName: 'Read the Message',
        name: 'readMessage',
        type: 'boolean',
        default: true,
        description:
          'Whether to read the message before starting, so the item carries its text and attachments. Pidgeon’s webhooks carry IDs and a summary, never the body.',
      },
      {
        displayName: 'Body',
        name: 'body',
        type: 'options',
        displayOptions: { show: { readMessage: [true] } },
        options: [
          {
            name: 'Clean',
            value: 'clean',
            description: 'The text with anything hidden or addressed to an AI taken out',
          },
          {
            name: 'Original',
            value: 'original',
            description:
              'Exactly as sent. Can carry hidden instructions: give it to a model only if you have to.',
          },
        ],
        default: 'clean',
      },
    ],
  };

  methods = {
    loadOptions: { getInboxes },
  };

  webhookMethods = {
    default: {
      async checkExists(this: IHookFunctions): Promise<boolean> {
        const url = this.getNodeWebhookUrl('default') as string;
        const endpoints = endpointsOf(this.getWorkflowStaticData('node'));
        const mine = endpoints[url];
        if (!mine) return false;

        const listed = await pidgeonRequest.call(this, 'GET', '/v1/webhooks');
        const webhook = ((listed.data as IDataObject[] | undefined) ?? []).find(
          (entry) => entry.id === mine.id,
        );
        if (webhook && webhook.url === url && !webhook.disabled_at) return true;

        // Gone, or turned off after failing deliveries: start again.
        if (webhook) await pidgeonRequest.call(this, 'DELETE', `/v1/webhooks/${mine.id}`);
        delete endpoints[url];
        return false;
      },

      async create(this: IHookFunctions): Promise<boolean> {
        const events = this.getNodeParameter('events') as string[];
        if (!events.length) throw new NodeOperationError(this.getNode(), 'Choose an event.');
        const inboxIds = this.getNodeParameter('inboxIds', []) as string[];
        const url = this.getNodeWebhookUrl('default') as string;

        const created = await pidgeonRequest.call(this, 'POST', '/v1/webhooks', {
          body: { url, events, inbox_ids: inboxIds.length ? inboxIds : undefined },
        });
        // The secret is answered once, here, and shown to nobody.
        endpointsOf(this.getWorkflowStaticData('node'))[url] = {
          id: String(created.id),
          secret: String(created.secret),
        };
        return true;
      },

      async delete(this: IHookFunctions): Promise<boolean> {
        const url = this.getNodeWebhookUrl('default') as string;
        const endpoints = endpointsOf(this.getWorkflowStaticData('node'));
        const mine = endpoints[url];
        if (mine) {
          const listed = await pidgeonRequest.call(this, 'GET', '/v1/webhooks');
          const exists = ((listed.data as IDataObject[] | undefined) ?? []).some(
            (entry) => entry.id === mine.id,
          );
          if (exists) await pidgeonRequest.call(this, 'DELETE', `/v1/webhooks/${mine.id}`);
        }
        delete endpoints[url];
        return true;
      },
    },
  };

  async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
    const request = this.getRequestObject();
    const raw = request.rawBody ? request.rawBody.toString('utf8') : JSON.stringify(request.body);

    const signed = Object.values(endpointsOf(this.getWorkflowStaticData('node'))).some(
      ({ secret }) =>
        verifySignature({ secret, header: request.header('pidgeon-signature'), body: raw }),
    );
    if (!signed) {
      this.getResponseObject().status(401).json({ error: 'The signature does not match.' });
      return { noWebhookResponse: true };
    }

    const event = JSON.parse(raw) as {
      id: string;
      type: string;
      created: string;
      data: IDataObject;
    };
    const events = this.getNodeParameter('events') as string[];
    if (!events.includes(event.type)) return {};

    const item: IDataObject = {
      event_id: event.id,
      event: event.type,
      created: event.created,
      ...event.data,
    };
    const messageId = event.data.message_id;
    if (this.getNodeParameter('readMessage', true) && typeof messageId === 'string') {
      const body = this.getNodeParameter('body', 'clean') as string;
      item.message = await pidgeonRequest.call(
        this,
        'GET',
        `/v1/email/messages/${encodeURIComponent(messageId)}`,
        { qs: { body } },
      );
    }
    return { workflowData: [this.helpers.returnJsonArray([item])] };
  }
}

/**
 * The webhooks this node made, by the URL each delivers to: n8n listens on
 * the editor's test URL and on the published one, and testing a published
 * workflow must not remove the published one's webhook.
 */
function endpointsOf(stored: IDataObject): Record<string, { id: string; secret: string }> {
  stored.endpoints ??= {};
  return stored.endpoints as Record<string, { id: string; secret: string }>;
}
