import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { cachedDirectory, staticDirectory, type Directory, type DirectoryAgent } from './directory';
import type { GrantRule, IssuerOptions, StaticClient } from './issuer';
import { fileSigner, seedSigner, type RetiredKey } from './signer';

/**
 * `issuer.json`, the one file a company writes (`issuer.example.json`).
 * Secrets never go in it: the key is a file it names (mounted as a secret)
 * or `PIDGEON_ISSUER_KEY`, and a connector's credential comes from the
 * environment variable the connector names.
 */
export interface IssuerFile {
  domain: string;
  issuer?: string;
  organisation?: string;
  /** The key file, relative to this file. `PIDGEON_ISSUER_KEY` (the seed) wins when set. */
  key?: string;
  /** Keys being withdrawn: published until `not_after`. */
  retired?: { key: string; not_after: string }[];
  directory: { static: DirectoryAgent[] };
  grants?: GrantRule[];
  clients?: StaticClient[];
  client_metadata_hosts?: string[];
  /** How long the list of agents is held for the public reads, in seconds. Default 60. */
  directory_cache_seconds?: number;
}

export async function loadConfig(
  path: string,
  env: Record<string, string | undefined> = process.env,
): Promise<IssuerOptions> {
  let file: IssuerFile;
  try {
    file = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read ${path}: ${error instanceof Error ? error.message : error}`);
  }
  if (typeof file.domain !== 'string' || !file.domain.includes('.')) {
    throw new Error(`${path}: \`domain\` is the domain whose agents this issues for.`);
  }
  const here = (relative: string) => resolve(dirname(path), relative);

  const signer = env.PIDGEON_ISSUER_KEY
    ? seedSigner(env.PIDGEON_ISSUER_KEY, { domain: file.domain })
    : file.key
      ? await fileSigner(here(file.key))
      : null;
  if (!signer) throw new Error(`${path}: name a \`key\` file, or set PIDGEON_ISSUER_KEY.`);

  const retired: RetiredKey[] = [];
  for (const entry of file.retired ?? []) {
    const old = await fileSigner(here(entry.key));
    retired.push({ kid: old.kid, publicKey: old.publicKey, notAfter: new Date(entry.not_after) });
  }

  return {
    domain: file.domain,
    issuer: file.issuer,
    organisation: file.organisation,
    signer,
    retired,
    directory: cachedDirectory(directoryFrom(file, path), file.directory_cache_seconds ?? 60),
    grants: file.grants,
    clients: file.clients,
    clientMetadataHosts: file.client_metadata_hosts,
  };
}

function directoryFrom(file: IssuerFile, path: string): Directory {
  if (Array.isArray(file.directory?.static)) {
    for (const agent of file.directory.static) {
      if (!agent.address?.toLowerCase().endsWith(`@${file.domain.toLowerCase()}`)) {
        throw new Error(`${path}: ${agent.address} is not an address at ${file.domain}.`);
      }
    }
    return staticDirectory(file.directory.static);
  }
  throw new Error(`${path}: \`directory\` is { "static": [...] }.`);
}
