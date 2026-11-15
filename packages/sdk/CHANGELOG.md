# Changelog

## 2.4.0

- `signedFetch`, `agentFromEnv().fetch` and `agentFromKeyFile().fetch` send
  a request with a body. They threw "Cannot construct a Request with a
  Request object that has already been used" on any POST or PUT with one.
- Every signature carries a fresh 64-byte nonce and covers `@query` (`?`
  when the URL has none), so neither the query nor the signature can be
  reused: sign again to retry. `newNonce()`; `signAgentRequest` takes
  `nonce` for tests. `verifyAgentRequest` answers the signature's `nonce`.
- `VerifyAnswer`: `replay_protected`, and the reason `replayed`.
- `messages.search` takes `search(q, options)` or `search({ q, ...options })`;
  with no words it rejects with a `TypeError` instead of answering nothing.
- `agents.update`, `agents.revoke`, `agents.revokeKey` and `pods.remove`.
- `WEBHOOK_EVENTS` has `mandate.requested`, `mandate.granted`,
  `mandate.declined` and `mandate.revoked`.
- Typings no longer cite documents outside the package.

## 2.3.0

- `messages.search` takes `body: 'clean'`, as reading does.
- `WEBHOOK_EVENTS` and `WebhookEventType`: the events a webhook carries.
  `webhooks.create`, `Webhook.events` and `WebhookPayload.type` use them,
  so a misspelt event fails to compile rather than with a 400.
- Types say what the API answers: `CalendarEvent` in full, `Site` with
  `created_at`, `Mandate.status` and `request_expires_at`, `Inbox.status`.
- `calendar.update` takes `null` to clear `description` or `location`;
  `calendar.create` takes no `end` for an all-day event; `subject` and
  `testInbound`'s `subject` are optional, as in the API.
- `drafts.update` no longer takes `replyTo`: a draft keeps its conversation.

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
