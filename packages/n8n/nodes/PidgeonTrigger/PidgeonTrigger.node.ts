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

import { getAddresses } from '../shared/loadOptions';
import { flatMessage, flatThreadChange, isHandOff, type Envelope } from '../shared/mapping';
import { verifySignature } from '../shared/signature';
import { pidgeonRequest } from '../shared/transport';

type Trigger = 'messageReceived' | 'threadHandedOff';

/**
 * Pidgeon's trigger. It makes its own webhook on Pidgeon when the workflow
 * starts listening and removes it when it stops, so nobody copies a URL or
 * a secret.
 *
 * n8n calls `create` for the test URL while a person listens in the editor
 * and again for the production URL when the workflow is published, so each
 * gets its own endpoint, and each counts against the plan's endpoints while
 * it exists.
 */
export class PidgeonTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Pidgeon Trigger',
    name: 'pidgeonTrigger',
    icon: { light: 'file:../../icons/pidgeon.svg', dark: 'file:../../icons/pidgeon.dark.svg' },
    group: ['trigger'],
    version: 1,
    subtitle:
      '={{$parameter["event"] === "threadHandedOff" ? "Thread handed off" : "Message received"}}',
    description:
      'Starts the workflow when mail arrives at an address, or when a thread changes hands',
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
        displayName: 'Trigger On',
        name: 'event',
        type: 'options',
        noDataExpression: true,
        options: [
          {
            name: 'Message Received',
            value: 'messageReceived',
            description: 'Mail arrives at the address',
          },
          {
            name: 'Thread Handed Off',
            value: 'threadHandedOff',
            description: 'A person takes a thread, or gives it back to the agent',
          },
        ],
        default: 'messageReceived',
      },
      {
        displayName: 'Address Name or ID',
        name: 'address',
        type: 'options',
        typeOptions: { loadOptionsMethod: 'getAddresses' },
        required: true,
        default: '',
        description:
          'The address to watch. One address per trigger, and a key that reaches only it. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
      },
      {
        displayName: 'Direction',
        name: 'direction',
        type: 'options',
        displayOptions: { show: { event: ['threadHandedOff'] } },
        options: [
          {
            name: 'To a Person',
            value: 'toPerson',
            description: 'A person takes the thread, or it is assigned to somebody',
          },
          {
            name: 'Back to the Agent',
            value: 'toAgent',
            description: 'A person hands the thread back',
          },
          { name: 'Either', value: 'either' },
        ],
        default: 'toPerson',
      },
      {
        displayName: 'Include Spam',
        name: 'includeSpam',
        type: 'boolean',
        displayOptions: { show: { event: ['messageReceived'] } },
        default: false,
        description: 'Whether to start the workflow for mail filed as spam too',
      },
      {
        displayName: 'Fetch the Message',
        name: 'fetchMessage',
        type: 'boolean',
        displayOptions: { show: { event: ['messageReceived'] } },
        default: true,
        description:
          'Whether to read the message and its thread before starting, so the item carries the text, sender authentication, codes and links. Pidgeon’s webhooks carry IDs and metadata, never a body.',
      },
      {
        displayName: 'Body',
        name: 'body',
        type: 'options',
        displayOptions: { show: { event: ['messageReceived'], fetchMessage: [true] } },
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
              'Exactly as sent. Can carry hidden instructions; give it to a model only if you have to.',
          },
        ],
        default: 'clean',
      },
    ],
  };

  methods = {
    loadOptions: { getAddresses },
  };

  webhookMethods = {
    default: {
      async checkExists(this: IHookFunctions): Promise<boolean> {
        const url = this.getNodeWebhookUrl('default')!;
        const endpoints = endpointsOf(this.getWorkflowStaticData('node'));
        const mine = endpoints[url];
        if (!mine) return false;

        const found = await pidgeonRequest.call(this, 'GET', `/webhooks/${mine.id}`, {
          allowNotFound: true,
        });
        const webhook = found.data as IDataObject | null;
        if (webhook && webhook.url === url && webhook.status === 'active') return true;

        // Gone, or disabled after failures: start again.
        if (webhook) {
          await pidgeonRequest.call(this, 'DELETE', `/webhooks/${mine.id}`, {
            allowNotFound: true,
          });
        }
        delete endpoints[url];
        return false;
      },

      async create(this: IHookFunctions): Promise<boolean> {
        const event = this.getNodeParameter('event') as Trigger;
        const identityId = this.getNodeParameter('address') as string;
        if (!identityId)
          throw new NodeOperationError(this.getNode(), 'Choose an address to watch.');

        const eventTypes =
          event === 'threadHandedOff'
            ? ['thread.updated', 'thread.assigned']
            : (this.getNodeParameter('includeSpam', false) as boolean)
              ? ['message.received', 'message.spam']
              : ['message.received'];

        const url = this.getNodeWebhookUrl('default')!;
        const created = await pidgeonRequest.call(this, 'POST', '/webhooks', {
          body: { url, identity_id: identityId, event_types: eventTypes },
        });
        const webhook = created.data as IDataObject;

        // The secret is returned once, here, and never shown to anybody.
        endpointsOf(this.getWorkflowStaticData('node'))[url] = {
          id: String(webhook.id),
          secret: String(webhook.secret),
        };
        return true;
      },

      async delete(this: IHookFunctions): Promise<boolean> {
        const url = this.getNodeWebhookUrl('default')!;
        const endpoints = endpointsOf(this.getWorkflowStaticData('node'));
        const mine = endpoints[url];
        if (mine) {
          await pidgeonRequest.call(this, 'DELETE', `/webhooks/${mine.id}`, {
            allowNotFound: true,
          });
        }
        delete endpoints[url];
        return true;
      },
    },
  };

  async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
    const request = this.getRequestObject();
    const raw = request.rawBody ? request.rawBody.toString('utf8') : JSON.stringify(request.body);

    // The editor's test URL and the published one each have an endpoint and a secret.
    const signed = Object.values(endpointsOf(this.getWorkflowStaticData('node'))).some(
      ({ secret }) =>
        verifySignature({
          secret,
          signature: request.header('x-pidgeon-signature'),
          timestamp: request.header('x-pidgeon-timestamp'),
          body: raw,
        }),
    );
    if (!signed) {
      const response = this.getResponseObject();
      response.status(401).json({ error: 'The signature does not match.' });
      return { noWebhookResponse: true };
    }

    const envelope = JSON.parse(raw) as Envelope;
    const event = this.getNodeParameter('event') as Trigger;

    if (event === 'threadHandedOff') {
      const direction = this.getNodeParameter('direction', 'toPerson') as
        'toPerson' | 'toAgent' | 'either';
      if (!isHandOff(envelope, direction)) return {};

      const thread = await readThread.call(this, envelope.data.thread_id);
      return { workflowData: [this.helpers.returnJsonArray([flatThreadChange(envelope, thread)])] };
    }

    if (envelope.type !== 'message.received' && envelope.type !== 'message.spam') return {};

    const fetch = this.getNodeParameter('fetchMessage', true) as boolean;
    let message: IDataObject | undefined;
    let thread: IDataObject | undefined;
    // A routed delivery is not stored, so there is nothing to read: its body came with it.
    if (fetch && envelope.data.stored !== false && envelope.data.message_id) {
      const body = this.getNodeParameter('body', 'clean') as string;
      const read = await pidgeonRequest.call(
        this,
        'GET',
        `/messages/${String(envelope.data.message_id)}`,
        { qs: { body } },
      );
      message = read.data as IDataObject;
      thread = await readThread.call(this, envelope.data.thread_id);
    }

    return {
      workflowData: [this.helpers.returnJsonArray([flatMessage({ envelope, message, thread })])],
    };
  }
}

async function readThread(
  this: IWebhookFunctions,
  threadId: unknown,
): Promise<IDataObject | undefined> {
  if (!threadId) return undefined;
  const read = await pidgeonRequest.call(this, 'GET', `/threads/${String(threadId)}`, {
    allowNotFound: true,
  });
  return (read.data as IDataObject | null) ?? undefined;
}

/**
 * The endpoints this node made, by the URL each delivers to.
 *
 * Keyed by URL because n8n listens on two: the editor's test URL while a
 * person tests, and the production URL once the workflow is published. One
 * id for both meant that testing a published workflow deleted the
 * production endpoint, as one "pointing elsewhere".
 */
function endpointsOf(stored: IDataObject): Record<string, { id: string; secret: string }> {
  stored.endpoints ??= {};
  return stored.endpoints as Record<string, { id: string; secret: string }>;
}
