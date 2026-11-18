import {
  NodeConnectionTypes,
  NodeOperationError,
  type IDataObject,
  type IExecuteFunctions,
  type INodeExecutionData,
  type INodeType,
  type INodeTypeDescription,
  type NodeApiError,
} from 'n8n-workflow';

import { getInboxes } from '../shared/loadOptions';
import { pidgeonRequest, pidgeonRequestAll } from '../shared/transport';
import {
  agentRequestFields,
  attachmentFields,
  draftFields,
  inboxFields,
  messageFields,
  operationFields,
  resourceField,
  threadFields,
} from './descriptions';

export class Pidgeon implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Pidgeon',
    name: 'pidgeon',
    icon: { light: 'file:../../icons/pidgeon.svg', dark: 'file:../../icons/pidgeon.dark.svg' },
    group: ['output'],
    version: 1,
    subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
    description:
      'Inboxes for AI agents, and checking the agents that reach your site: send, reply, read and wait for mail, and verify an agent’s request',
    defaults: {
      name: 'Pidgeon',
    },
    usableAsTool: true,
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    credentials: [{ name: 'pidgeonApi', required: true }],
    properties: [
      resourceField,
      ...operationFields,
      ...agentRequestFields,
      ...attachmentFields,
      ...draftFields,
      ...inboxFields,
      ...messageFields,
      ...threadFields,
    ],
  };

  methods = {
    loadOptions: { getInboxes },
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const results: INodeExecutionData[] = [];

    for (let i = 0; i < items.length; i++) {
      try {
        const output = await run.call(this, i);
        for (const entry of output) results.push({ ...entry, pairedItem: { item: i } });
      } catch (error) {
        if (this.continueOnFail()) {
          results.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
          continue;
        }
        throw new NodeOperationError(this.getNode(), error as Error, {
          itemIndex: i,
          description: (error as NodeApiError).description ?? undefined,
        });
      }
    }

    return [results];
  }
}

const segment = (id: string) => encodeURIComponent(id.trim());

/** `a@x.com, b@y.com` or an array, as the list of addresses the API takes. */
function addressList(value: unknown): string[] {
  const parts = Array.isArray(value) ? value : String(value ?? '').split(',');
  return parts.map((part) => String(part).trim()).filter(Boolean);
}

/** The optional parts of a message, from an Additional Fields collection. */
function extras(fields: IDataObject): IDataObject {
  const out: IDataObject = {};
  const cc = addressList(fields.cc);
  const bcc = addressList(fields.bcc);
  const attachments = addressList(fields.attachmentIds);
  if (cc.length) out.cc = cc;
  if (bcc.length) out.bcc = bcc;
  if (fields.html) out.html = fields.html;
  if (attachments.length) out.attachment_ids = attachments;
  return out;
}

async function run(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
  const resource = this.getNodeParameter('resource', i) as string;
  const operation = this.getNodeParameter('operation', i) as string;
  const json = (data: unknown): INodeExecutionData[] =>
    (Array.isArray(data) ? data : [data]).map((entry) => ({ json: entry as IDataObject }));
  const param = <T>(name: string, fallback?: T) => this.getNodeParameter(name, i, fallback) as T;
  const limitOf = () => (param<boolean>('returnAll') ? Infinity : param<number>('limit'));

  if (resource === 'agentRequest' && operation === 'verify') {
    const raw = param<string | IDataObject>('headers');
    let headers: IDataObject;
    try {
      headers = typeof raw === 'string' ? (JSON.parse(raw) as IDataObject) : raw;
    } catch {
      throw new NodeOperationError(this.getNode(), 'Headers must be a JSON object.', {
        itemIndex: i,
      });
    }
    const flat: IDataObject = {};
    for (const [name, value] of Object.entries(headers ?? {})) {
      if (value !== undefined && value !== null)
        flat[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
    }
    return json(
      await pidgeonRequest.call(this, 'POST', '/v1/verify', {
        body: {
          request: { method: param<string>('method'), url: param<string>('url'), headers: flat },
        },
      }),
    );
  }

  if (resource === 'attachment' && operation === 'download') {
    const id = param<string>('attachmentId');
    const field = param<string>('binaryPropertyName');
    const link = await pidgeonRequest.call(this, 'GET', `/v1/email/attachments/${segment(id)}`);
    // A signed link that expires in minutes: followed now, never stored.
    const file = (await this.helpers.httpRequest({
      method: 'GET',
      url: String(link.url),
      encoding: 'arraybuffer',
      json: false,
    })) as ArrayBuffer;
    const fileName = String(link.filename ?? id);
    const binary = await this.helpers.prepareBinaryData(
      Buffer.from(file),
      fileName,
      link.content_type ? String(link.content_type) : undefined,
    );
    const attachment: IDataObject = { ...link };
    delete attachment.url;
    return [{ json: attachment, binary: { [field]: binary } }];
  }

  if (resource === 'draft') {
    if (operation === 'create') {
      const inboxId = param<string>('inboxId');
      const body: IDataObject = {
        to: addressList(param('to')),
        subject: param<string>('subject', '') || undefined,
        text: param<string>('text', '') || undefined,
        reply_to: param<string>('replyTo', '').trim() || undefined,
        ...extras(param<IDataObject>('additionalFields', {})),
      };
      const draft = await pidgeonRequest.call(
        this,
        'POST',
        `/v1/email/inboxes/${segment(inboxId)}/drafts`,
        { body },
      );
      if (!param<boolean>('requestApproval', false)) return json(draft);
      return json(
        await pidgeonRequest.call(
          this,
          'POST',
          `/v1/email/drafts/${segment(String(draft.id))}/approval`,
          {
            body: {},
          },
        ),
      );
    }
    if (operation === 'send') {
      const sendAt = param<string>('sendAt', '');
      return json(
        await pidgeonRequest.call(
          this,
          'POST',
          `/v1/email/drafts/${segment(param('draftId'))}/send`,
          {
            body: sendAt ? { send_at: new Date(sendAt).toISOString() } : {},
          },
        ),
      );
    }
  }

  if (resource === 'inbox') {
    if (operation === 'create') {
      const extra = param<IDataObject>('additionalFields', {});
      return json(
        await pidgeonRequest.call(this, 'POST', '/v1/email/inboxes', {
          body: {
            name: param<string>('name').trim(),
            kind: extra.kind || 'agent',
            display_name: extra.displayName || undefined,
            agent_id: extra.agentId || undefined,
            pod_id: extra.podId || undefined,
            domain: extra.domain || undefined,
          },
        }),
      );
    }
    if (operation === 'get') {
      return json(
        await pidgeonRequest.call(this, 'GET', `/v1/email/inboxes/${segment(param('inboxId'))}`),
      );
    }
    if (operation === 'getAll') {
      return json(await pidgeonRequestAll.call(this, '/v1/email/inboxes', {}, limitOf()));
    }
  }

  if (resource === 'message') {
    const body = param<string>('body', 'clean');

    if (operation === 'get') {
      return json(
        await pidgeonRequest.call(
          this,
          'GET',
          `/v1/email/messages/${segment(param('messageId'))}`,
          {
            qs: { body },
          },
        ),
      );
    }

    if (operation === 'getAll') {
      return json(
        await pidgeonRequestAll.call(
          this,
          `/v1/email/inboxes/${segment(param('inboxId'))}/messages`,
          { body },
          limitOf(),
        ),
      );
    }

    if (operation === 'search') {
      const found = await pidgeonRequest.call(this, 'GET', '/v1/email/search', {
        qs: {
          q: param<string>('query'),
          inbox_id: param<string>('searchInboxId', ''),
          limit: Math.min(100, param<number>('limit')),
          body,
        },
      });
      return json(found.data ?? []);
    }

    if (operation === 'send') {
      const to = addressList(param('to'));
      if (!to.length)
        throw new NodeOperationError(this.getNode(), 'Name somebody to send to.', { itemIndex: i });
      return json(
        await pidgeonRequest.call(
          this,
          'POST',
          `/v1/email/inboxes/${segment(param('inboxId'))}/messages`,
          {
            body: {
              to,
              subject: param<string>('subject', '') || undefined,
              text: param<string>('text'),
              ...extras(param<IDataObject>('additionalFields', {})),
            },
          },
        ),
      );
    }

    if (operation === 'reply') {
      // To its sender (or, for mail the inbox sent, its recipients), from the inbox it is in.
      const original = await pidgeonRequest.call(
        this,
        'GET',
        `/v1/email/messages/${segment(param('messageId'))}`,
      );
      const subject = String(original.subject ?? '');
      const from = original.from as IDataObject | undefined;
      return json(
        await pidgeonRequest.call(
          this,
          'POST',
          `/v1/email/inboxes/${segment(String(original.inbox_id))}/messages`,
          {
            body: {
              to: original.direction === 'in' ? [String(from?.address)] : original.to,
              subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`,
              text: param<string>('text'),
              reply_to: original.id,
              ...extras(param<IDataObject>('additionalFields', {})),
            },
          },
        ),
      );
    }

    if (operation === 'wait') {
      // Pidgeon holds each wait open for up to 50 seconds; longer waits ask again.
      const path = `/v1/email/inboxes/${segment(param('inboxId'))}/messages/await`;
      const deadline = Date.now() + param<number>('timeout') * 1000;
      let since = param<string>('since', '') || undefined;
      for (;;) {
        const left = Math.ceil((deadline - Date.now()) / 1000);
        const answer = await pidgeonRequest.call(this, 'GET', path, {
          qs: { since, timeout: Math.max(0, Math.min(50, left)), body },
          timeout: 90,
        });
        const arrived = (answer.data as IDataObject[] | undefined) ?? [];
        since = answer.next_since ? String(answer.next_since) : since;
        if (arrived.length) return json(arrived);
        if (left <= 50) {
          return json({ timed_out: true, held: answer.held ?? 0, next_since: since ?? null });
        }
      }
    }
  }

  if (resource === 'thread') {
    if (operation === 'get') {
      return json(
        await pidgeonRequest.call(this, 'GET', `/v1/email/threads/${segment(param('threadId'))}`, {
          qs: { body: param<string>('body', 'clean'), limit: 200 },
        }),
      );
    }
    if (operation === 'getAll') {
      const filters = param<IDataObject>('filters', {});
      return json(
        await pidgeonRequestAll.call(
          this,
          '/v1/email/threads',
          {
            inbox_id: filters.inboxId,
            folder: filters.folder,
            status: filters.status,
            starred: filters.starred ? 'true' : undefined,
          },
          limitOf(),
        ),
      );
    }
    if (operation === 'update') {
      const fields = param<IDataObject>('updateFields', {});
      if (!Object.keys(fields).length)
        throw new NodeOperationError(this.getNode(), 'Choose at least one field to update.', {
          itemIndex: i,
        });
      return json(
        await pidgeonRequest.call(
          this,
          'PATCH',
          `/v1/email/threads/${segment(param('threadId'))}`,
          {
            body: {
              folder: fields.folder,
              starred: fields.starred,
              status: fields.status,
              owner_type: fields.ownerType,
            },
          },
        ),
      );
    }
  }

  throw new NodeOperationError(this.getNode(), `Unknown operation: ${resource} ${operation}`, {
    itemIndex: i,
  });
}
