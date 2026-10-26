type Json = Record<string, unknown>;

interface Person {
  email: string;
  name?: string | null;
}

/** A webhook delivery: `{ id, type, created_at, data }`. */
export interface Envelope {
  id: string;
  type: string;
  created_at: string;
  data: Json;
}

/**
 * One message as a flow step's output: flat, on purpose.
 *
 * A Router branch or a Branch step reaches a field by name, and
 * `auth_dmarc` is a thing a person picks from the data panel where
 * `message.authentication.dmarc` is a thing they dig for. Every field a
 * router branches on is a plain value here, so a flow needs no model to
 * decide where mail goes.
 *
 * Any of the three inputs may be missing: a read has no event, a routed
 * delivery has no stored message, and the thread is a second read.
 */
export function flatMessage(input: { envelope?: Envelope; message?: Json; thread?: Json }): Json {
  const event = input.envelope?.data ?? {};
  const message = input.message ?? {};
  const thread = input.thread;

  const from = message['from'] as Person | undefined;
  const to =
    (message['to'] as Person[] | undefined)?.map((person) => person.email) ??
    (event['to'] as string[] | undefined) ??
    [];
  const cc = (message['cc'] as Person[] | undefined)?.map((person) => person.email) ?? [];
  const deliveredTo =
    (message['delivered_to'] as string | null | undefined) ??
    (event['delivered_to'] as string | undefined) ??
    null;
  const address = (message['identity'] as string | undefined) ?? (event['identity'] as string | undefined);
  const firewall = (message['firewall'] ?? event['firewall']) as
    | { verdict?: string; signals?: Array<string | { kind: string }> }
    | null
    | undefined;
  const auth = message['authentication'] as
    | { spf: string | null; dkim: string | null; dmarc: string | null }
    | undefined;
  const extracted = message['extracted'] as { codes?: Json[]; links?: Json[] } | undefined;

  const item: Json = {};
  if (input.envelope) {
    item['event'] = input.envelope.type;
    item['event_id'] = input.envelope.id;
  }

  Object.assign(item, {
    message_id: message['id'] ?? event['message_id'] ?? null,
    thread_id: message['thread_id'] ?? event['thread_id'] ?? null,
    address: address ?? null,
    from: from?.email ?? event['from'] ?? null,
    from_name: from?.name ?? null,
    to,
    cc,
    delivered_to: deliveredTo,
    subject: message['subject'] ?? event['subject'] ?? null,
    received_at: message['created_at'] ?? input.envelope?.created_at ?? null,
    spam: message['is_spam'] ?? event['spam'] ?? false,
    from_self: event['from_self'] ?? false,
    bcc_to_this_address: isBcc(deliveredTo ?? address, to, cc),
    firewall_verdict: firewall?.verdict ?? null,
    firewall_signals: (firewall?.signals ?? []).map((signal) =>
      typeof signal === 'string' ? signal : signal.kind,
    ),
    auth_spf: auth?.spf ?? null,
    auth_dkim: auth?.dkim ?? null,
    auth_dmarc: auth?.dmarc ?? null,
  });

  if (thread) {
    Object.assign(item, {
      is_reply: ((thread['message_count'] as number | undefined) ?? 1) > 1,
      thread_status: thread['status'] ?? null,
      thread_owner_type: thread['owner_type'] ?? null,
      thread_assignee_id: thread['assignee_id'] ?? null,
    });
  }

  // A routed delivery stores nothing and carries its own body.
  const text = (message['text'] as string | null | undefined) ?? (event['text'] as string | undefined);
  Object.assign(item, {
    text: text ?? null,
    reply_text: message['reply_text'] ?? text ?? null,
    codes: (extracted?.codes ?? []).map((code) => code['value']),
    links: extracted?.links ?? [],
    attachments: message['attachments'] ?? event['attachments'] ?? [],
    test: message['test'] ?? event['test'] ?? false,
  });
  if (event['stored'] === false) item['stored'] = false;

  return item;
}

/**
 * BCC'd: the address it was delivered to is in neither `to` nor `cc`. That
 * is how a flow knows it is watching a conversation rather than in one.
 */
function isBcc(deliveredTo: string | null | undefined, to: string[], cc: string[]): boolean {
  if (!deliveredTo) return false;
  const own = deliveredTo.toLowerCase();
  return ![...to, ...cc].some((recipient) => recipient.toLowerCase() === own);
}
