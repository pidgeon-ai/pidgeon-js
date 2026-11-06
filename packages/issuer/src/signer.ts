import { readFile } from 'node:fs/promises';

import { identityFromSeed } from '@pidgeon-ai/id';

/**
 * The issuer's signing key, behind one interface so custody never touches
 * the protocol: a file today; AWS KMS or an HSM over PKCS#11 implement the
 * same three members and nothing else changes.
 *
 * Everything the issuer signs is a JWS signing input (a card, an ID token,
 * a grant), a few hundred bytes, so a KMS that signs pure Ed25519 only up to
 * 4 KB (AWS's limit) is enough here. Agents sign their own mail and requests
 * with their own keys; the issuer never does.
 */
export interface Signer {
  /** The key's RFC 8037 JWK thumbprint: its `kid` in the policy, the JWKS and every JWS. */
  readonly kid: string;
  /** 32 bytes. */
  readonly publicKey: Uint8Array;
  /** Ed25519 over exactly these bytes. */
  sign(message: Uint8Array): Promise<Uint8Array>;
}

/** A key the issuer no longer signs with but still publishes, until `notAfter`. */
export interface RetiredKey {
  kid: string;
  publicKey: Uint8Array;
  notAfter: Date;
}

/**
 * The key file `pidgeon-issuer keygen` writes, which is the same format as
 * `pidgeon id init`'s: `{v: 1, domain, kid, seed}`, the seed base64url.
 * Mount it as a secret, mode 0600; it is read once at start.
 */
export async function fileSigner(path: string): Promise<Signer> {
  let file: { v?: number; domain?: string; kid?: string; seed?: string };
  try {
    file = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new Error(`No key at ${path}. Make one with \`pidgeon-issuer keygen <domain>\`.`);
  }
  if (file.v !== 1 || typeof file.seed !== 'string') {
    throw new Error(`${path} is not a Pidgeon key file.`);
  }
  return seedSigner(file.seed, { domain: file.domain ?? 'issuer', expectKid: file.kid, path });
}

/** A key from its seed, base64url: `PIDGEON_ISSUER_KEY` in the environment. */
export function seedSigner(
  seed: string,
  options: { domain?: string; expectKid?: string; path?: string } = {},
): Signer {
  const identity = identityFromSeed({
    domain: options.domain ?? 'issuer',
    seed: new Uint8Array(Buffer.from(seed, 'base64url')),
  });
  if (identity.seed.length !== 32) throw new Error('An Ed25519 seed is 32 bytes.');
  if (options.expectKid && options.expectKid !== identity.kid) {
    throw new Error(`${options.path ?? 'The key'} is damaged: its key does not match its kid.`);
  }
  return {
    kid: identity.kid,
    publicKey: identity.publicKey,
    sign: async (message) => identity.sign(message),
  };
}
