import { createHash } from 'crypto';

import {
  NodeConnectionTypes,
  NodeOperationError,
  type IDataObject,
  type IExecuteFunctions,
  type NodeApiError,
  type INodeExecutionData,
  type INodeType,
  type INodeTypeDescription,
} from 'n8n-workflow';

import { getAddressEmails, getAddresses, getMembers } from '../shared/loadOptions';
import { addressList, flatMessage } from '../shared/mapping';
import { pidgeonRequest, pidgeonRequestAll } from '../shared/transport';
import {
  addressFields,
  attachmentFields,
  draftFields,
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
    description: 'Email inboxes for AI agents: reply, save drafts, send, and wait for codes',
    defaults: {
      name: 'Pidgeon',
    },
    /*
     * As a tool, the builder picks the operation when they add it, and the
     * model fills in its fields. So an agent gets the verbs it was given —
     * a Save draft, a Search — and sending stays a step somebody wired.
     */
    usableAsTool: true,
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    credentials: [{ name: 'pidgeonApi', required: true }],
    properties: [
      resourceField,
      ...operationFields,
      ...addressFields,
      ...messageFields,
      ...draftFields,
      ...threadFields,
      ...attachmentFields,
    ],
  };

  methods = {
    loadOptions: { getAddresses, getAddressEmails, getMembers },
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

/**
 * The key for one write: this n8n, this workflow, this execution, this node,
 * this item.
 *
 * n8n's Retry On Fail runs the node again inside the same execution, so a
 * send whose answer was lost is replayed by Pidgeon rather than sent twice.
 * A new execution is a new key, as it should be: it is a new run.
 *
 * The instance and the workflow are in it because execution ids start at 1
 * on every n8n, and a node imported from a template keeps the template's
 * id: without them, a second n8n on the same Pidgeon account reused the
 * first one's keys and every write was refused as a conflict. Hashed,
 * because Pidgeon takes at most 255 characters.
 */
function idempotencyKey(this: IExecuteFunctions, item: number | string): Record<string, string> {
  const run = [
    this.getInstanceId(),
    this.getWorkflow().id,
    this.getExecutionId(),
    this.getNode().id,
    item,
  ].join(':');
  return { 'Idempotency-Key': `n8n-${createHash('sha256').update(run).digest('hex')}` };
}

async function run(this: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
  const resource = this.getNodeParameter('resource', i) as string;
  const operation = this.getNodeParameter('operation', i) as string;
  const json = (data: unknown): INodeExecutionData[] =>
    (Array.isArray(data) ? data : [data]).map((entry) => ({ json: entry as IDataObject }));

  if (resource === 'address') {
    if (operation === 'create') {
      const extra = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
      const body: IDataObject = {
        address: (this.getNodeParameter('newAddress', i) as string).trim(),
        type: this.getNodeParameter('type', i),
        inbox: this.getNodeParameter('inbox', i, true),
        send_policy: this.getNodeParameter('sendPolicy', i),
      };
      if (extra.display_name) body.display_name = extra.display_name;
      if (extra.pod_id) body.pod_id = extra.pod_id;

      /*
       * **Keyed by the address, not the item.** n8n runs a node once per
       * input item, so a create fed two items asked for the same address
       * twice: the first made it and the second showed "already exists"
       * (Patrick, recording the verification video, 27 October). One address
       * per name per run is what a create means, so a second item naming the
       * same address replays the first one's answer.
       */
      const created = await pidgeonRequest.call(this, 'POST', '/identities', {
        body,
        headers: idempotencyKey.call(this, `address:${String(body.address).toLowerCase()}`),
      });
      return json(created.data);
    }

    if (operation === 'getAll') {
      const returnAll = this.getNodeParameter('returnAll', i) as boolean;
      const limit = returnAll ? Infinity : (this.getNodeParameter('limit', i) as number);
      return json(
        await pidgeonRequestAll.call(this, '/identities', { limit: Math.min(limit, 200) }, limit),
      );
    }
  }

  if (resource === 'message') {
    if (operation === 'get') {
      const id = this.getNodeParameter('messageId', i) as string;
      const body = this.getNodeParameter('body', i) as string;
      const read = await pidgeonRequest.call(this, 'GET', `/messages/${encodeURIComponent(id)}`, {
        qs: { body },
      });
      return json(flatMessage({ message: read.data as IDataObject }));
    }

    if (operation === 'send') {
      const extra = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
      const to = addressList(this.getNodeParameter('to', i));
      if (to.length === 0)
        throw new NodeOperationError(this.getNode(), 'Name somebody to send to.', { itemIndex: i });

      const body: IDataObject = {
        from: this.getNodeParameter('from', i),
        to,
        subject: this.getNodeParameter('subject', i, ''),
        text: this.getNodeParameter('text', i),
        ...recipients(extra),
      };
      if (extra.html) body.html = extra.html;

      const sent = await pidgeonRequest.call(this, 'POST', '/messages', {
        body,
        headers: idempotencyKey.call(this, i),
      });
      return json(sent.data);
    }

    if (operation === 'reply') {
      const id = this.getNodeParameter('messageId', i) as string;
      const extra = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
      const body: IDataObject = { text: this.getNodeParameter('text', i), ...recipients(extra) };
      if (extra.html) body.html = extra.html;

      const sent = await pidgeonRequest.call(
        this,
        'POST',
        `/messages/${encodeURIComponent(id)}/reply`,
        { body, headers: idempotencyKey.call(this, i) },
      );
      return json(sent.data);
    }

    if (operation === 'search') {
      const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
      const found = await pidgeonRequest.call(this, 'GET', '/messages/search', {
        qs: {
          q: this.getNodeParameter('q', i, ''),
          identity_id: filters.identity_id,
          in: filters.in,
          from: filters.from,
          to: filters.to,
          limit: this.getNodeParameter('limit', i),
        },
      });
      return json(found.data ?? []);
    }

    if (operation === 'awaitCode') {
      const options = this.getNodeParameter('awaitOptions', i, {}) as IDataObject;
      const timeout = this.getNodeParameter('timeout', i) as number;
      const qs: IDataObject = {
        identity_id: this.getNodeParameter('identityId', i),
        body: this.getNodeParameter('body', i),
        timeout,
        has_code: options.has_code === false ? undefined : 'true',
        from: options.from,
        subject_contains: options.subject_contains,
        after: options.after,
      };

      // Held open by Pidgeon until mail arrives, so the request outlives the wait.
      const awaited = await pidgeonRequest.call(this, 'GET', '/messages/await', {
        qs,
        timeout: timeout + 30,
      });
      const data = awaited.data as IDataObject;
      const message = data.message as IDataObject | null;
      const item = message ? flatMessage({ message }) : {};
      return json({
        code: (item.codes as string[] | undefined)?.[0] ?? null,
        ...item,
        timed_out: data.timed_out ?? !message,
        cursor: data.cursor ?? null,
        held_back: data.held_back ?? null,
      });
    }
  }

  if (resource === 'draft') {
    if (operation === 'create') {
      const extra = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
      const inReplyTo = (this.getNodeParameter('inReplyTo', i, '') as string).trim();
      const subject = this.getNodeParameter('subject', i, '') as string;
      const body: IDataObject = {
        identity_id: this.getNodeParameter('identityId', i),
        to: addressList(this.getNodeParameter('to', i, '')),
        text: this.getNodeParameter('text', i, ''),
        ...recipients(extra),
      };
      if (subject) body.subject = subject;
      if (inReplyTo) body.in_reply_to = inReplyTo;

      const saved = await pidgeonRequest.call(this, 'POST', '/drafts', {
        body,
        headers: idempotencyKey.call(this, i),
      });
      return json(saved.data);
    }

    if (operation === 'send') {
      const id = this.getNodeParameter('draftId', i) as string;
      const sent = await pidgeonRequest.call(
        this,
        'POST',
        `/drafts/${encodeURIComponent(id)}/send`,
        {
          headers: idempotencyKey.call(this, i),
        },
      );
      return json(sent.data);
    }
  }

  if (resource === 'thread') {
    const id = this.getNodeParameter('threadId', i) as string;
    const reason = (this.getNodeParameter('reason', i, '') as string).trim();
    const body: IDataObject =
      operation === 'handToPerson'
        ? {
            owner_type: 'human',
            assignee_id: (this.getNodeParameter('assigneeId', i, '') as string) || null,
          }
        : { owner_type: 'agent' };
    if (reason) body.reason = reason;

    const updated = await pidgeonRequest.call(this, 'PATCH', `/threads/${encodeURIComponent(id)}`, {
      body,
    });
    return json(updated.data);
  }

  if (resource === 'attachment' && operation === 'download') {
    const id = this.getNodeParameter('attachmentId', i) as string;
    const field = this.getNodeParameter('binaryPropertyName', i) as string;
    const link = await pidgeonRequest.call(this, 'GET', `/attachments/${encodeURIComponent(id)}`);
    const url = (link.data as IDataObject).url as string;

    // A signed link that expires in minutes, so it is followed now and never stored.
    const response = (await this.helpers.httpRequest({
      method: 'GET',
      url,
      encoding: 'arraybuffer',
      returnFullResponse: true,
      json: false,
    })) as { body: ArrayBuffer | Buffer; headers: Record<string, string | undefined> };

    const fileName = fileNameOf(response.headers['content-disposition']) ?? id;
    const binary = await this.helpers.prepareBinaryData(
      Buffer.from(response.body as ArrayBuffer),
      fileName,
      response.headers['content-type'],
    );
    return [{ json: { attachment_id: id, file_name: fileName }, binary: { [field]: binary } }];
  }

  throw new NodeOperationError(this.getNode(), `Unknown operation: ${resource} ${operation}`, {
    itemIndex: i,
  });
}

function recipients(extra: IDataObject): IDataObject {
  const out: IDataObject = {};
  const cc = addressList(extra.cc);
  const bcc = addressList(extra.bcc);
  if (cc.length) out.cc = cc;
  if (bcc.length) out.bcc = bcc;
  return out;
}

function fileNameOf(disposition: string | undefined): string | undefined {
  if (!disposition) return undefined;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (encoded) return decodeURIComponent(encoded[1]);
  const plain = /filename="?([^";]+)"?/i.exec(disposition);
  return plain?.[1];
}
