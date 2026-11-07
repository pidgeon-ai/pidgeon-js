/**
 * `@pidgeon-ai/issuer`: a Post issuer a company runs itself, inside its own
 * network. Its own domain signs its agents' cards, ID tokens and grants, with
 * a key that never leaves it, for the agents its identity provider says it
 * has. Pidgeon is the format and the check, never the identity provider.
 *
 * - `createIssuer`: the issuer as a Web `Request` handler: agents by token
 *   exchange, and people through the company's OpenID Connect provider.
 * - `serve`: the same on `node:http`; `pidgeon-issuer serve` runs it.
 * - `fileSigner` / `seedSigner`: the key; any `Signer` (a KMS, an HSM) fits.
 * - `keycloakDirectory`: Keycloak says who the agents are; `staticDirectory`
 *   lists them in the config.
 */
export {
  createIssuer,
  memoryReplayStore,
  PATHS,
  TOKEN_EXCHANGE,
  type GrantRule,
  type Issuer,
  type IssuerOptions,
  type ReplayStore,
  type StaticClient,
} from './issuer';
export { cachedDirectory, staticDirectory, type Directory, type DirectoryAgent } from './directory';
export { keycloakDirectory, type KeycloakOptions } from './keycloak';
export { type PersonOptions } from './person';
export { fileSigner, seedSigner, type RetiredKey, type Signer } from './signer';
export { loadConfig, type IssuerFile } from './config';
export { serve } from './server';
export { runIssuer, UsageError } from './cli';
