import { createHash, randomUUID } from 'node:crypto';

import type { Identity } from './keys';

/**
 * Signing an agent's email: the `Post-Envelope` header (Post, `docs/spec/`
 * §"The Signed Envelope"), Ed25519 by the From domain over the message as
 * JSON. Works through any provider that lets you set a header — SES, Gmail's
 * API, Resend, Postmark, Nodemailer over SMTP — because the signature
 * travels in the message, not in the transport.
 *
 * A receiver checks it against the key `post.<domain>/.well-known/post.json`
 * publishes (anyone, offline) or by sending the message to Pidgeon's
 * verifier (`POST /v1/verify`). What the verifier compares, and so what
 * must be sent exactly as signed: the From address, the subject, To and Cc,
 * the plain-text body (line endings and trailing whitespace aside) and the
 * attachments' SHA-256. Send the same `text` as the message's text/plain
 * part; an HTML part beside it is not covered.
 *
 * The JSON's shape and order are the server's (`src/lib/mail/envelope.ts`
 * `messageBytes`); `tests/unit/id-email.test.ts` holds them together.
 */

export const ENVELOPE_VERSION = 'post0';

export interface SignEmailInput {
  /** The agent's address. Its domain must be the identity's. */
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  /** The text/plain body, exactly as sent. */
  text: string;
  kind?: 'agent' | 'service';
  /** Who the agent acts for, as its card says: a person or a company. */
  onBehalfOf?: string | null;
  /** Stable per message. A new UUID when omitted. */
  id?: string;
  thread?: { id: string; parent?: string | null };
  /** Typed data carried beside the text, when the message has some. */
  data?: { schema: string; body: unknown } | null;
  attachments?: { contentType: string; filename: string; content: Uint8Array }[];
  createdAt?: Date;
  /**
   * Grants the agent was given (compact JWS), to show the recipient what it
   * may do. Each becomes a `Post-Grant` field. A grant holds only beside a
   * signature from the agent it names, which this envelope is.
   */
  grants?: string[];
}

export interface SignedEmail {
  /** The header to add: `Post-Envelope`. */
  headers: { 'Post-Envelope': string };
  /** One `Post-Grant` field per grant, in order: add each as its own header line. */
  grantHeaders: [string, string][];
  /** The exact bytes signed, for a test or a log. */
  message: Uint8Array;
}

export function signEmail(identity: Identity, input: SignEmailInput): SignedEmail {
  const from = input.from.trim().toLowerCase();
  if (from.slice(from.lastIndexOf('@') + 1) !== identity.domain) {
    throw new Error(`${from} is not an address at ${identity.domain}, whose key this is.`);
  }

  const id = input.id ?? randomUUID();
  const thread = input.thread ?? { id };
  const message = {
    v: ENVELOPE_VERSION,
    id,
    thread: { id: thread.id, ...(thread.parent ? { parent: thread.parent } : {}) },
    sender: {
      address: from,
      kind: input.kind ?? 'agent',
      ...(input.onBehalfOf ? { on_behalf_of: input.onBehalfOf } : {}),
    },
    to: input.to,
    cc: input.cc ?? [],
    created_at: (input.createdAt ?? new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    subject: input.subject,
    parts: [
      { role: 'text', type: 'text/plain', body: input.text },
      ...(input.data ? [{ role: 'data', schema: input.data.schema, body: input.data.body }] : []),
      ...(input.attachments ?? []).map((file) => ({
        role: 'attachment',
        type: file.contentType,
        name: file.filename,
        sha256: createHash('sha256').update(file.content).digest('hex'),
        size: file.content.length,
      })),
    ],
  };

  const bytes = new TextEncoder().encode(JSON.stringify(message));
  const signature = identity.sign(bytes);
  // 76-character runs, separated by spaces, which any mailer folds onto continuation lines.
  const runs = (value: Uint8Array) =>
    (
      Buffer.from(value)
        .toString('base64url')
        .match(/.{1,76}/g) ?? []
    ).join(' ');

  return {
    headers: {
      'Post-Envelope': [
        `v=${ENVELOPE_VERSION}`,
        `d=${identity.domain}`,
        `k=${identity.kid}`,
        `s=${runs(signature)}`,
        `m=${runs(bytes)}`,
      ].join('; '),
    },
    message: bytes,
    grantHeaders: (input.grants ?? []).map((jws) => [
      'Post-Grant',
      (jws.replace(/\s+/g, '').match(/.{1,76}/g) ?? []).join(' '),
    ]),
  };
}
