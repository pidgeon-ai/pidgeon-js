import type { IDataObject } from 'n8n-workflow';

/**
 * The shapes n8n items take.
 *
 * Flat, on purpose: an IF or Switch node reaches a field by name, and
 * `{{ $json.auth_dmarc }}` is a thing a person types where
 * `{{ $json.message.authentication.dmarc }}` is a thing they look up. Every
 * field a router branches on is a plain value here, so a deterministic flow
 * needs no model to decide where mail goes.
 */

interface Person {
  email: string;
  name?: string | null;
}

/** A webhook delivery: `{ id, type, created_at, data }`. */
export interface Envelope {
  id: string;
  type: string;
  created_at: string;
  data: IDataObject;
}

/**
 * One message, from `GET /messages/{id}`, and what the event and its thread
 * add. Any of the three may be missing: a Get has no event, a routed
 * delivery has no stored message, and the thread is a second read.
 */
export function flatMessage(input: {
  envelope?: Envelope;
  message?: IDataObject;
  thread?: IDataObject;
}): IDataObject {
  const event = input.envelope?.data ?? {};
  const message = input.message ?? {};
  const thread = input.thread;

  const from = message.from as Person | undefined;
  const to =
    (message.to as Person[] | undefined)?.map((person) => person.email) ??
    (event.to as string[] | undefined) ??
    [];
  const cc = (message.cc as Person[] | undefined)?.map((person) => person.email) ?? [];
  const deliveredTo =
    (message.delivered_to as string | null | undefined) ??
    (event.delivered_to as string | undefined) ??
    null;
  const address =
    (message.identity as string | undefined) ?? (event.identity as string | undefined);
  const firewall = (message.firewall ?? event.firewall) as
    { verdict?: string; signals?: Array<string | { kind: string }> } | null | undefined;
  const auth = message.authentication as
    { spf: string | null; dkim: string | null; dmarc: string | null } | undefined;
  const extracted = message.extracted as
    { codes?: IDataObject[]; links?: IDataObject[] } | undefined;

  const item: IDataObject = {};
  if (input.envelope) {
    item.event = input.envelope.type;
    item.event_id = input.envelope.id;
  }

  Object.assign(item, {
    message_id: (message.id as string | undefined) ?? event.message_id ?? null,
    thread_id: (message.thread_id as string | undefined) ?? event.thread_id ?? null,
    address: address ?? null,
    from: from?.email ?? (event.from as string | undefined) ?? null,
    from_name: from?.name ?? null,
    to,
    cc,
    delivered_to: deliveredTo,
    subject: (message.subject as string | null | undefined) ?? event.subject ?? null,
    received_at: (message.created_at as string | undefined) ?? input.envelope?.created_at ?? null,
    spam: (message.is_spam as boolean | undefined) ?? (event.spam as boolean | undefined) ?? false,
    from_self: (event.from_self as boolean | undefined) ?? false,
    bcc_to_this_address: isBcc(deliveredTo ?? address, to, cc),
    firewall_verdict: firewall?.verdict ?? null,
    firewall_signals: (firewall?.signals ?? []).map((signal) =>
      typeof signal === 'string' ? signal : signal.kind,
    ),
    auth_spf: auth?.spf ?? null,
    auth_dkim: auth?.dkim ?? null,
    auth_dmarc: auth?.dmarc ?? null,
  });

  if (event.matched_by !== undefined) item.matched_by = event.matched_by;

  if (thread) {
    Object.assign(item, {
      is_reply: ((thread.message_count as number | undefined) ?? 1) > 1,
      thread_status: thread.status ?? null,
      thread_owner_type: thread.owner_type ?? null,
      thread_assignee_id: thread.assignee_id ?? null,
    });
  }

  // A routed delivery stores nothing and carries its own body.
  const text = (message.text as string | null | undefined) ?? (event.text as string | undefined);
  Object.assign(item, {
    text: text ?? null,
    reply_text: (message.reply_text as string | undefined) ?? text ?? null,
    codes: (extracted?.codes ?? []).map((code) => code.value),
    links: extracted?.links ?? [],
    attachments: (message.attachments as IDataObject[] | undefined) ?? event.attachments ?? [],
    test: (message.test as boolean | undefined) ?? (event.test as boolean | undefined) ?? false,
  });
  if (event.stored === false) {
    item.stored = false;
    if (event.html !== undefined) item.html = event.html;
  }

  return item;
}

/**
 * BCC'd: the address it was delivered to is in neither `to` nor `cc`. That
 * is how the agent knows it is watching a conversation rather than in one.
 */
function isBcc(deliveredTo: string | null | undefined, to: string[], cc: string[]): boolean {
  if (!deliveredTo) return false;
  const own = deliveredTo.toLowerCase();
  return ![...to, ...cc].some((recipient) => recipient.toLowerCase() === own);
}

/** A thread's ownership changing: `thread.updated` or `thread.assigned`. */
export function flatThreadChange(envelope: Envelope, thread?: IDataObject): IDataObject {
  const event = envelope.data;
  return {
    event: envelope.type,
    event_id: envelope.id,
    thread_id: event.thread_id ?? null,
    owner_type: (event.owner_type as string | undefined) ?? thread?.owner_type ?? null,
    previous_owner_type: event.previous_owner_type ?? null,
    status: (event.status as string | undefined) ?? thread?.status ?? null,
    assignee_id: (event.assignee_id as string | null | undefined) ?? thread?.assignee_id ?? null,
    assigned_by: event.assigned_by ?? null,
    reason: event.reason ?? null,
    address: thread?.identity ?? null,
    subject: thread?.subject ?? null,
    from: thread?.from ?? null,
    changed_at: envelope.created_at,
  };
}

/** Whether a thread change is the hand-off the trigger was set to watch. */
export function isHandOff(
  envelope: Envelope,
  direction: 'toPerson' | 'toAgent' | 'either',
): boolean {
  const event = envelope.data;
  const toPerson =
    (envelope.type === 'thread.updated' &&
      event.owner_type === 'human' &&
      event.previous_owner_type !== 'human') ||
    (envelope.type === 'thread.assigned' && Boolean(event.assignee_id));
  const toAgent =
    envelope.type === 'thread.updated' &&
    event.owner_type !== 'human' &&
    event.previous_owner_type === 'human';

  if (direction === 'toPerson') return toPerson;
  if (direction === 'toAgent') return toAgent;
  return toPerson || toAgent;
}

/** A comma- or newline-separated list of addresses, as a person types it. */
export function addressList(value: unknown): string[] {
  if (Array.isArray(value))
    return value
      .map(String)
      .map((entry) => entry.trim())
      .filter(Boolean);
  if (typeof value !== 'string') return [];
  return value
    .split(/[,;\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}
