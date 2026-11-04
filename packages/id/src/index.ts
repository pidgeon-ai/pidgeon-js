/**
 * `@pidgeon-ai/id`: a signed identity for an AI agent on its operator's own
 * domain, and the open library it signs with.
 *
 * - `signEmail`: the `Post-Envelope` header, for mail sent through any provider.
 * - `signRequest` / `signedFetch`: HTTP Message Signatures (RFC 9421) in Web
 *   Bot Auth's profile, for HTTP requests and for MCP over Streamable HTTP.
 * - `verifyRequest`: the receiving side, for an MCP server or an API.
 * - `signInWithPidgeon`: sign in to a website as the agent, with its card and grant.
 * - `IdClient` and `runId`: issuance, as `pidgeon id` drives it.
 */
export {
  generateIdentity,
  identityFromSeed,
  jwkThumbprint,
  loadIdentity,
  saveIdentity,
} from './keys';
export type { Identity, StoredIdentity } from './keys';
export { signEmail, type SignEmailInput, type SignedEmail } from './email';
export {
  contentDigest,
  signedFetch,
  signRequest,
  verifyRequest,
  type RequestCheck,
  type SignRequestInput,
} from './http';
export {
  IdApiError,
  IdClient,
  rotationStatement,
  type AgentCardDocument,
  type IdAgent,
  type IdDomain,
  type IdGrant,
} from './api';
export {
  fetchCard,
  JWT_BEARER,
  dpopProof,
  PIDGEON_ISSUER,
  signInWithApiKey,
  signInWithPidgeon,
  SignInError,
  siteMetadata,
  TOKEN_EXCHANGE,
  type PidgeonSignIn,
  type SignInWithApiKeyInput,
  type SignInWithPidgeonInput,
  type SiteMetadata,
} from './sign-in';
export { runId, UsageError } from './cli';
export {
  a2aSigningPayload,
  canonicalJson,
  POST_A2A_EXTENSION,
  postIdentityExtension,
  signA2aCard,
  verifyA2aCard,
  type A2aAgentCard,
  type A2aCardCheck,
  type A2aExtension,
  type AgentCardSignature,
} from './a2a';
