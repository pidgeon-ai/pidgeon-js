/**
 * `@pidgeon-ai/issuer`: a Post issuer a company runs itself, inside its own
 * network. Its own domain signs its agents' cards, ID tokens and grants, with
 * a key that never leaves it, for the agents its identity provider says it
 * has. Pidgeon is the format and the check, never the identity provider.
 *
 * - `createIssuer`: the issuer as a Web `Request` handler: agents by token
 *   exchange, and people through the company's OpenID Connect provider.
 * - `serve`: the same on `node:http`; `pidgeon-issuer serve` runs it.
 * - `fileSigner` / `seedSigner` / `kmsSigner`: the key, in a file or in AWS
 *   KMS; any `Signer` (an HSM) fits.
 * - `keycloakDirectory`, `auth0Directory`, `oktaDirectory`: the identity
 *   provider says who the agents are; `staticDirectory` lists them in the
 *   config.
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
export { auth0Directory, type Auth0Options } from './auth0';
export { oktaDirectory, type OktaOptions } from './okta';
export { type PersonOptions } from './person';
export { kmsRetiredKey, kmsSigner, type KmsApi, type KmsSignerOptions } from './kms';
export { fileSigner, seedSigner, type RetiredKey, type Signer } from './signer';
export { loadConfig, type IssuerFile, type KeyRef } from './config';
export { serve } from './server';
export { runIssuer, UsageError } from './cli';
