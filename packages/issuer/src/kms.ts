import { createPublicKey, verify } from 'node:crypto';

import { jwkThumbprint } from '@pidgeon-ai/id';

import type { RetiredKey, Signer } from './signer';

/**
 * The issuer's key in AWS KMS: an `ECC_NIST_EDWARDS25519` key, which signs
 * pure Ed25519 (`ED25519_SHA_512` over the message itself, `MessageType:
 * RAW`, up to 4 KB). Everything the issuer signs is a JWS signing input of a
 * few hundred bytes, so the key never has to leave KMS and nothing else in
 * the issuer changes.
 *
 * **Pinned at start.** The key is read once (`GetPublicKey`): an alias is
 * resolved to the key's ARN, and every `Sign` names that ARN, so re-pointing
 * the alias later changes nothing until the issuer restarts and publishes
 * the new key. **Every signature is checked** against the public key read at
 * start before it leaves, so the issuer never hands out a token its own
 * JWKS does not verify.
 *
 * The issuer's role needs `kms:GetPublicKey` and `kms:Sign` on that key and
 * nothing else. `@aws-sdk/client-kms` is an optional peer dependency,
 * loaded only here; pass `kms` to use a client of your own.
 */

export const KMS_KEY_SPEC = 'ECC_NIST_EDWARDS25519';
export const KMS_SIGNING_ALGORITHM = 'ED25519_SHA_512';

/** The two KMS calls the issuer makes, as `@aws-sdk/client-kms` shapes them. */
export interface KmsApi {
  getPublicKey(input: { KeyId: string }): Promise<{
    KeyId?: string;
    KeySpec?: string;
    KeyUsage?: string;
    SigningAlgorithms?: string[];
    PublicKey?: Uint8Array;
  }>;
  sign(input: {
    KeyId: string;
    Message: Uint8Array;
    MessageType: 'RAW';
    SigningAlgorithm: string;
  }): Promise<{ KeyId?: string; Signature?: Uint8Array }>;
}

export interface KmsSignerOptions {
  /** The key's ARN, id, or an alias (`alias/pidgeon-issuer`), resolved once at start. */
  keyId: string;
  /** Default the SDK's: `AWS_REGION`, then the profile's. */
  region?: string;
  kms?: KmsApi;
}

/** `@aws-sdk/client-kms`, loaded only when a KMS key is configured. */
async function sdkClient(region?: string): Promise<KmsApi> {
  let sdk: typeof import('@aws-sdk/client-kms');
  try {
    sdk = await import('@aws-sdk/client-kms');
  } catch {
    throw new Error(
      'A KMS key needs @aws-sdk/client-kms: `npm install @aws-sdk/client-kms` beside the issuer.',
    );
  }
  const client = new sdk.KMSClient(region ? { region } : {});
  return {
    getPublicKey: (input) => client.send(new sdk.GetPublicKeyCommand(input)),
    sign: (input) =>
      client.send(
        new sdk.SignCommand({
          ...input,
          SigningAlgorithm:
            input.SigningAlgorithm as typeof sdk.SigningAlgorithmSpec.ED25519_SHA_512,
        }),
      ),
  };
}

/** The key's public half, read and checked: Ed25519, for signing, pure. */
async function readKey(kms: KmsApi, keyId: string) {
  let key;
  try {
    key = await kms.getPublicKey({ KeyId: keyId });
  } catch (error) {
    throw new Error(
      `KMS would not give the issuer ${keyId}'s public key (${error instanceof Error ? error.message : error}). Its role needs kms:GetPublicKey and kms:Sign on that key.`,
    );
  }
  if (key.KeySpec !== KMS_KEY_SPEC) {
    throw new Error(`${keyId} is a ${key.KeySpec} key. The issuer signs with ${KMS_KEY_SPEC}.`);
  }
  if (key.KeyUsage && key.KeyUsage !== 'SIGN_VERIFY') {
    throw new Error(`${keyId} is not a signing key.`);
  }
  if (!key.SigningAlgorithms?.includes(KMS_SIGNING_ALGORITHM)) {
    throw new Error(`${keyId} does not sign with ${KMS_SIGNING_ALGORITHM}.`);
  }
  if (!key.KeyId || !key.PublicKey) throw new Error(`KMS gave no public key for ${keyId}.`);
  const publicKey = createPublicKey({
    key: Buffer.from(key.PublicKey),
    format: 'der',
    type: 'spki',
  });
  const x = publicKey.export({ format: 'jwk' }).x;
  const raw = new Uint8Array(Buffer.from(x ?? '', 'base64url'));
  if (raw.length !== 32) throw new Error(`${keyId}'s public key is not an Ed25519 key.`);
  return { arn: key.KeyId, publicKey, raw };
}

export async function kmsSigner(options: KmsSignerOptions): Promise<Signer & { keyArn: string }> {
  const kms = options.kms ?? (await sdkClient(options.region));
  const { arn, publicKey, raw } = await readKey(kms, options.keyId);
  return {
    kid: jwkThumbprint(raw),
    publicKey: raw,
    keyArn: arn,
    async sign(message) {
      const signed = await kms.sign({
        KeyId: arn,
        Message: message,
        MessageType: 'RAW',
        SigningAlgorithm: KMS_SIGNING_ALGORITHM,
      });
      const signature = signed.Signature ? new Uint8Array(signed.Signature) : null;
      if (!signature || !verify(null, message, publicKey, signature)) {
        throw new Error(
          `KMS answered for ${arn} with a signature its public key does not verify. Nothing was signed.`,
        );
      }
      return signature;
    },
  };
}

/** A key in KMS the issuer no longer signs with, published until `notAfter`: its public half only. */
export async function kmsRetiredKey(
  options: KmsSignerOptions & { notAfter: Date },
): Promise<RetiredKey> {
  const kms = options.kms ?? (await sdkClient(options.region));
  const { raw } = await readKey(kms, options.keyId);
  return { kid: jwkThumbprint(raw), publicKey: raw, notAfter: options.notAfter };
}
