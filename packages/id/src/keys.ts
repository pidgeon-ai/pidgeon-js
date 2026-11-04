import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

// post-core, the protocol's Rust core, through the same WebAssembly the server runs.
import { wasmBase64 } from '../../../src/lib/post/wasm/bytes';
import * as core from '../../../src/lib/post/wasm/post_core_wasm.js';

/**
 * An operator's signing key for one domain: Ed25519, made on this machine
 * and never sent anywhere. Pidgeon holds only the public half.
 *
 * `kid` is the key's RFC 8037 JWK thumbprint, which is what Web Bot Auth
 * calls a `keyid` and what the domain's `post.json` lists, so one name
 * finds the key from an email, an HTTP request and the policy alike.
 */

let ready = false;
function wasm(): typeof core {
  if (!ready) {
    core.initSync({ module: Buffer.from(wasmBase64, 'base64') });
    ready = true;
  }
  return core;
}

export interface Identity {
  domain: string;
  kid: string;
  /** 32 bytes. */
  publicKey: Uint8Array;
  /** Ed25519 over exactly these bytes. */
  sign(message: Uint8Array): Uint8Array;
}

export interface StoredIdentity extends Identity {
  /** The private key. Kept in the identity file, mode 0600, and nowhere else. */
  seed: Uint8Array;
  /** The key this one replaced, while receivers may still hold it. */
  previous?: { kid: string; publicKey: Uint8Array } | null;
}

export const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');
export const fromB64url = (text: string) => new Uint8Array(Buffer.from(text, 'base64url'));

/** RFC 8037 §A.3. */
export function jwkThumbprint(publicKey: Uint8Array): string {
  return createHash('sha256')
    .update(`{"crv":"Ed25519","kty":"OKP","x":"${b64url(publicKey)}"}`)
    .digest('base64url');
}

export function verifyBytes(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array) {
  try {
    return wasm().verify(publicKey, message, signature);
  } catch {
    return false;
  }
}

export function identityFromSeed(input: { domain: string; seed: Uint8Array }): StoredIdentity {
  const seed = new Uint8Array(input.seed);
  const publicKey = wasm().publicKey(seed);
  return {
    domain: input.domain.toLowerCase(),
    kid: jwkThumbprint(publicKey),
    publicKey,
    seed,
    sign: (message) => wasm().sign(seed, message),
  };
}

export function generateIdentity(domain: string): StoredIdentity {
  return identityFromSeed({ domain, seed: wasm().generateSeed() });
}

// --- On disk ------------------------------------------------------------------

/** `$PIDGEON_ID_DIR`, else `~/.config/pidgeon/id`. One file per domain. */
export function identityDir(env: Record<string, string | undefined> = process.env): string {
  return (
    env.PIDGEON_ID_DIR || join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'pidgeon', 'id')
  );
}

interface IdentityFile {
  v: 1;
  domain: string;
  kid: string;
  seed: string;
  previous?: { kid: string; public_key: string } | null;
}

export async function saveIdentity(identity: StoredIdentity, dir = identityDir()): Promise<string> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `${identity.domain}.json`);
  const file: IdentityFile = {
    v: 1,
    domain: identity.domain,
    kid: identity.kid,
    seed: b64url(identity.seed),
    previous: identity.previous
      ? { kid: identity.previous.kid, public_key: b64url(identity.previous.publicKey) }
      : null,
  };
  await writeFile(path, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
  return path;
}

/**
 * The identity for `domain`, from `PIDGEON_ID_KEY` (`<domain>:<seed>`, for a
 * server the operator deploys to) or the identity file.
 */
export async function loadIdentity(
  domain: string,
  options: { dir?: string; env?: Record<string, string | undefined> } = {},
): Promise<StoredIdentity> {
  const env = options.env ?? process.env;
  const name = domain.toLowerCase();
  const fromEnv = env.PIDGEON_ID_KEY?.split(':');
  if (fromEnv?.length === 2 && fromEnv[0]!.toLowerCase() === name) {
    return identityFromSeed({ domain: name, seed: fromB64url(fromEnv[1]!) });
  }

  const path = join(options.dir ?? identityDir(env), `${name}.json`);
  let file: IdentityFile;
  try {
    file = JSON.parse(await readFile(path, 'utf8')) as IdentityFile;
  } catch {
    throw new Error(
      `No identity for ${name} on this machine. Run \`pidgeon id init ${name}\` first.`,
    );
  }
  const identity = identityFromSeed({ domain: file.domain, seed: fromB64url(file.seed) });
  if (identity.kid !== file.kid)
    throw new Error(`${path} is damaged: its key does not match its kid.`);
  identity.previous = file.previous
    ? { kid: file.previous.kid, publicKey: fromB64url(file.previous.public_key) }
    : null;
  return identity;
}

/** The domains with an identity file here. */
export async function listIdentities(dir = identityDir()): Promise<string[]> {
  try {
    return (await readdir(dir))
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.slice(0, -5));
  } catch {
    return [];
  }
}
