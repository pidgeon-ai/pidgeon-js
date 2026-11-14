# Changelog

## 2.0.0

For the new Pidgeon: Passport, Bouncer, Email and Auth. A new major version,
because nothing of 1.x carries over: 1.x spoke the old email API at
`/api/v1`, which is retired seven days after the switch. Stay on 1.68.0 until
you move.

- `Pidgeon`, the API client, grouped by product: `agents` (with `setUp`:
  register, make the key here, publish it signed with itself), `verify` and
  `report`, `inboxes`, `messages`, `drafts`, `rules`, `suppressions`, `sites`,
  `mandates`, `events`, `pods`, and `request` for any `/v1` call. It takes an
  API key or an OAuth access token (`getToken`, refreshed per request).
- Signing as an agent (Web Bot Auth, RFC 9421): `signedFetch`, `agentFromEnv`,
  `generateAgentKey`, `signAgentRequest`, `verifyAgentRequest`.
- `@pidgeon-ai/sdk/auth`: Sign in with Pidgeon. `signInAsAgent`,
  `verifyIdToken`, `verifyAgentSignIn`, `requestIdJag`.
- `@pidgeon-ai/sdk/node`: signing in from a terminal through Pidgeon's OAuth
  server, and agent keys kept on this machine (`setUpAgent`, `addAgentKey`,
  `agentFromKeyFile`). What the CLI and the MCP server share.
- `verifyWebhook` for webhook signatures.
