import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { cachedDirectory, staticDirectory, type Directory, type DirectoryAgent } from './directory';
import { keycloakDirectory } from './keycloak';
import type { GrantRule, IssuerOptions, StaticClient } from './issuer';
import { checkSecret } from './person';
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
  directory:
    | { static: DirectoryAgent[] }
    | {
        keycloak: {
          url: string;
          realm: string;
          /** The issuer's own client in that realm. */
          client_id: string;
          /** The environment variable holding its secret. Default `KEYCLOAK_CLIENT_SECRET`. */
          client_secret_env?: string;
          /** The group whose members are agents. Default `agents`. */
          group?: string;
        };
      };
  /**
   * A person's sign-in, through the company's OpenID Connect provider, with
   * the issuer as one of its clients. Needs `PIDGEON_ISSUER_SECRET`.
   */
  person?: {
    oidc: {
      /** The provider's issuer, as its ID tokens say. */
      issuer: string;
      /** Where the issuer reaches the provider's configuration, when not at its issuer URL. */
      discovery_url?: string;
      client_id: string;
      /** The environment variable holding its secret. Default `PIDGEON_PERSON_CLIENT_SECRET`. */
      client_secret_env?: string;
      token_auth?: 'client_secret_basic' | 'client_secret_post';
    };
    /** Default the domain. */
    email_domains?: string[];
  };
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

  let person: IssuerOptions['person'];
  if (file.person) {
    const { oidc } = file.person;
    const secretName = oidc?.client_secret_env ?? 'PIDGEON_PERSON_CLIENT_SECRET';
    if (!oidc?.issuer || !oidc.client_id) {
      throw new Error(
        `${path}: \`person.oidc\` names the provider's \`issuer\` and the \`client_id\`.`,
      );
    }
    const clientSecret = env[secretName];
    if (!clientSecret) {
      throw new Error(`${path}: set ${secretName}, the issuer's client secret at ${oidc.issuer}.`);
    }
    person = {
      secret: checkSecret(env.PIDGEON_ISSUER_SECRET),
      oidc: {
        issuer: oidc.issuer,
        discoveryUrl: oidc.discovery_url,
        clientId: oidc.client_id,
        clientSecret,
        tokenAuth: oidc.token_auth,
      },
      emailDomains: file.person.email_domains,
    };
  }

  return {
    domain: file.domain,
    person,
    issuer: file.issuer,
    organisation: file.organisation,
    signer,
    retired,
    directory: cachedDirectory(directoryFrom(file, path, env), file.directory_cache_seconds ?? 60),
    grants: file.grants,
    clients: file.clients,
    clientMetadataHosts: file.client_metadata_hosts,
  };
}

function directoryFrom(
  file: IssuerFile,
  path: string,
  env: Record<string, string | undefined>,
): Directory {
  const directory = file.directory ?? {};
  if ('keycloak' in directory) {
    const { keycloak } = directory;
    const secretName = keycloak.client_secret_env ?? 'KEYCLOAK_CLIENT_SECRET';
    const secret = env[secretName];
    if (!secret)
      throw new Error(`${path}: set ${secretName}, the issuer's Keycloak client secret.`);
    return keycloakDirectory({
      url: keycloak.url,
      realm: keycloak.realm,
      clientId: keycloak.client_id,
      clientSecret: secret,
      domain: file.domain,
      group: keycloak.group,
    });
  }
  if ('static' in directory && Array.isArray(directory.static)) {
    for (const agent of directory.static) {
      if (!agent.address?.toLowerCase().endsWith(`@${file.domain.toLowerCase()}`)) {
        throw new Error(`${path}: ${agent.address} is not an address at ${file.domain}.`);
      }
    }
    return staticDirectory(directory.static);
  }
  throw new Error(`${path}: \`directory\` is { "keycloak": {...} } or { "static": [...] }.`);
}
