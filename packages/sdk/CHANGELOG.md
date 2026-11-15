# Changelog

## 2.2.0

- `webhooks.create` takes `inboxIds`: the endpoint hears only those inboxes'
  events. `Webhook` has `inbox_ids`, null for one of the whole account.

## 2.1.1

- `calendar.create` and `calendar.update` take `attendees` and `sendInvites`,
  and `calendar.remove` takes `{ sendInvites }`: the attendees get an
  invitation, an update or a cancellation from the inbox. `CalendarEvent` has
  `organizer`, `attendees` and, after a write that sent, `invites`.

## 2.1.0

All of Email, and webhooks. Additive: 2.0 code runs unchanged.

- `messages`: `list`, `get` (`body: 'clean'` for the Firewall's cleaned text),
  `markSeen`, `await` (wait for mail), `search`; sending takes `attachmentIds`.
- `threads` (list, read, file, star, hand to a person, delete, labels),
  `labels`, `contacts`, `attachments` (`upload`, which goes straight to
  storage over 4 MB; `get`, a five-minute link), `calendar`, `domains` (mail
  on your own domain), `appPasswords` (for mail apps), `storage()`,
  `testInbound()` (with a test key), and `webhooks`.
- `inboxes.create` takes `domain`; `inboxes.holdSuspicious`.
- Types follow the API: an inbox's `kind` is `agent` or `events`, and it has
  `hold_suspicious` (no `owner_id`).

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
