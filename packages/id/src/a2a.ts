import { b64url, fromB64url, type Identity, verifyBytes } from './keys';

/**
 * A Post identity inside an A2A Agent Card (A2A 1.0.0, read 4 November:
 * `a2a-protocol.org/latest/specification` §4.4.1 and §8.4, and
 * `specification/a2a.proto`). Two pieces, both A2A's own mechanisms:
 *
 * - **An extension** (`capabilities.extensions[]`, A2A's `AgentExtension`),
 *   `uri` `POST_A2A_EXTENSION`, whose `params` carry the agent's Post card:
 *   its address, kind, `on_behalf_of`, the proved operator domain, the card
 *   URL and the card's JWS. A client that knows Post checks the JWS; one
 *   that does not ignores it, because `required` is false.
 * - **A signature** (`signatures[]`, A2A's `AgentCardSignature`): JWS JSON
 *   form with the payload left out, over the RFC 8785 canonical form of the
 *   card without `signatures`, by the operator's key. `alg` `EdDSA`, `kid`
 *   the key's JWK thumbprint, `jku` the domain's Web Bot Auth key directory
 *   (`https://post.<domain>/.well-known/http-message-signatures-directory`),
 *   which is a JWKS. So the key that signs the agent's mail, its HTTP
 *   requests and its A2A card is one key, published once.
 *
 * A2A's canonicalisation also drops proto default values. This drops
 * `signatures` and empty arrays, as the spec's example does, and leaves
 * every other field as given: a card built by hand round-trips; a card
 * re-serialised by a proto library that drops `false` may not.
 */

export const POST_A2A_EXTENSION = 'https://pidgeon.ai/post/a2a/v0';

export interface AgentCardSignature {
  protected: string;
  signature: string;
  header?: Record<string, unknown>;
}

/** The fields of an A2A card this file reads or writes; the rest pass through. */
export interface A2aAgentCard {
  name: string;
  description: string;
  capabilities: { extensions?: A2aExtension[]; [key: string]: unknown };
  signatures?: AgentCardSignature[];
  [key: string]: unknown;
}

export interface A2aExtension {
  uri: string;
  description?: string;
  required?: boolean;
  params?: Record<string, unknown>;
}

/** The card document `pidgeon id issue` returns, or `GET /v1/cards/{id}`. */
export interface PostCardDocument {
  url: string;
  jws: string;
  card: {
    address: string;
    kind: string;
    on_behalf_of?: string;
    operator?: { domain: string; verified: boolean };
  };
}

/** The `AgentExtension` that carries a Post card. */
export function postIdentityExtension(card: PostCardDocument): A2aExtension {
  return {
    uri: POST_A2A_EXTENSION,
    description: 'Post agent identity: a signed card for this agent’s address and operator.',
    required: false,
    params: {
      address: card.card.address,
      kind: card.card.kind,
      ...(card.card.on_behalf_of ? { on_behalf_of: card.card.on_behalf_of } : {}),
      ...(card.card.operator ? { operator: card.card.operator.domain } : {}),
      card_url: card.url,
      card_jws: card.jws,
    },
  };
}

/** RFC 8785 for JSON values: sorted keys (UTF-16 order), no whitespace, ECMAScript numbers. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value))
      throw new Error('JCS has no NaN or Infinity.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, member]) => member !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, member]) => `${JSON.stringify(key)}:${canonicalJson(member)}`).join(',')}}`;
}

/** What A2A signs: the card without `signatures`, empty arrays dropped, canonical. */
export function a2aSigningPayload(card: A2aAgentCard): string {
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value)
          .filter(([, member]) => !(Array.isArray(member) && member.length === 0))
          .map(([key, member]) => [key, strip(member)]),
      );
    }
    return value;
  };
  const { signatures: _signatures, ...rest } = card;
  return canonicalJson(strip(rest));
}

/**
 * The card with the Post extension added (replacing an older one) and
 * signed by the operator's key. Any signature it already had is dropped:
 * it was over a card without the extension.
 */
export function signA2aCard(
  identity: Identity,
  card: A2aAgentCard,
  post?: PostCardDocument,
): A2aAgentCard {
  const extensions = (card.capabilities.extensions ?? []).filter(
    (extension) => extension.uri !== POST_A2A_EXTENSION,
  );
  const withIdentity: A2aAgentCard = {
    ...card,
    capabilities: {
      ...card.capabilities,
      extensions: post ? [...extensions, postIdentityExtension(post)] : extensions,
    },
  };
  delete withIdentity.signatures;

  const header = {
    alg: 'EdDSA',
    typ: 'JOSE',
    kid: identity.kid,
    jku: `https://post.${identity.domain}/.well-known/http-message-signatures-directory`,
  };
  const protectedHeader = b64url(new TextEncoder().encode(JSON.stringify(header)));
  const payload = b64url(new TextEncoder().encode(a2aSigningPayload(withIdentity)));
  const signature = identity.sign(new TextEncoder().encode(`${protectedHeader}.${payload}`));

  return {
    ...withIdentity,
    signatures: [{ protected: protectedHeader, signature: b64url(signature) }],
  };
}

export type A2aCardCheck =
  | { ok: true; kid: string; jku: string | null; identity: A2aExtension['params'] | null }
  | { ok: false; reason: string };

/**
 * Whether one of the card's signatures holds under the key `key` finds (by
 * `kid` and `jku`; fetch the JWKS at `jku` only from a host you trust for
 * the operator's domain, such as `post.<domain>`). Only `EdDSA` here.
 */
export async function verifyA2aCard(
  card: A2aAgentCard,
  key: (kid: string, jku: string | null) => Promise<Uint8Array | null>,
): Promise<A2aCardCheck> {
  const payload = b64url(new TextEncoder().encode(a2aSigningPayload(card)));
  for (const entry of card.signatures ?? []) {
    let header: { alg?: string; kid?: string; jku?: string } | null;
    try {
      header = JSON.parse(new TextDecoder().decode(fromB64url(entry.protected)));
    } catch {
      continue;
    }
    // A header that is JSON but not an object (`null`, a number) is a
    // signature we cannot read: skipped like any other, never a throw that
    // turns a refusal into a crash (found porting this to Python, 6 November).
    if (!header || typeof header !== 'object') continue;
    if (header.alg !== 'EdDSA' || typeof header.kid !== 'string') continue;
    const publicKey = await key(header.kid, header.jku ?? null);
    if (!publicKey) continue;
    if (
      verifyBytes(
        publicKey,
        new TextEncoder().encode(`${entry.protected}.${payload}`),
        fromB64url(entry.signature),
      )
    ) {
      const extension = card.capabilities.extensions?.find(
        (candidate) => candidate.uri === POST_A2A_EXTENSION,
      );
      return {
        ok: true,
        kid: header.kid,
        jku: header.jku ?? null,
        identity: extension?.params ?? null,
      };
    }
  }
  return { ok: false, reason: card.signatures?.length ? 'no_signature_verifies' : 'unsigned' };
}
