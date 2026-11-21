# Changelog

## 2.13.0

- `inboxes.setAgent(id, agentId)`: link an existing inbox to an agent identity in its pod,
  so its mail is signed as that agent, or pass `null` to unlink it (`PATCH
/v1/email/inboxes/{id}`, `agent_id`). Needs `admin` and a verified domain.
- `agents.*` and `Agent` are described as agent identities: who an agent is when it signs
  mail and signs in. Linking an inbox to one stays optional. Nothing else changed.
- `domains.remove` says what it does now: a proved domain's mail is turned off first, and
  it stays while an inbox is at it.

## 2.12.0

- Domains from the API (`/v1/domains`): `domains.create(domain, { podId })`,
  `domains.verify(id)` and `domains.remove(id)`. `domains.list()` and `domains.get(id)`
  now read `/v1/domains`, which answers what they did and more (the pod, the DNS records
  to publish). A key of one pod reaches its own pod's domains only.

## 2.11.1

- The package's description, keywords and README lead with what Pidgeon is now:
  email inboxes for AI agents, pods for platforms, then Sign in with Pidgeon. No
  code changes.

## 2.11.0

- Declared agents: `verify` answers a fifth `result`, `declared`, for an unsigned request
  whose User-Agent names an AI agent on Pidgeon's list (ChatGPT-User, Claude-User,
  Perplexity-User, …), with `declared` (`name`, `operator`, `purpose`, and `ip`:
  `confirmed`, `mismatch` or `unchecked` against the vendor's published addresses). Such a
  request was `refused`, `unsigned` before. Never `valid`, and no verdict.
- `bouncer()` (`@pidgeon-ai/sdk/next`) reports declared agents too, with the visitor's
  address (Netlify's `context.ip`, Vercel's `x-real-ip`, or the new `ip` option).
  `isAgentRequest`, `DECLARED_AGENT_TOKENS` and `declaredAgentToken` are exported.
- `pidgeon.visits.record(visits)` (`POST /v1/visits`): record declared agents' visits, up
  to 100 at a time, not counted as verifications. `bouncer()` sends declared agents there,
  in batches a second apart, with the URL's path only, instead of checking each one.
- `bouncer({ place })` in observe mode records where each visit was, for the dashboard.

## 2.10.0

- Site rules for Bouncer: `pidgeon.siteRules.get()` and `.set()` (`/v1/site-rules`).
- `verify(request, { place })`: `signup`, `checkout`, `api` or `other`. Every answer carries
  `place`, `decision` (`allow`, `limit`, `block` or `watch`), `would` and `rule`, and so
  does the verdict (`VerdictClaims`).
- `bouncer({ mode: 'enforce', place })` (`@pidgeon-ai/sdk/next`): a place's check is awaited
  and a blocked agent answered with a 403. `verdictFor` sends `place: 'signup'` unless told
  otherwise.

## 2.9.0

- `pidgeon.pods.move(podId, { type, id })` (`POST /v1/pods/{id}/move`): move an agent
  (with its addresses and mail), an address, a domain, a webhook endpoint or a site into a pod.
- `webhooks.create({ podId })`, and `Webhook.pod_id`. A key of one pod lists, adds and
  removes its own pod's webhooks.

## 2.8.0

- `pidgeon.pods.rename(id, name)` (`PATCH /v1/pods/{id}`).
- Verdicts at sign-up: `verify` answers `verdict` for every result but
  `refused`, a token Pidgeon signs for five minutes, for a sign-up hook that
  cannot see the request. `verify(request, { ip })` writes the agent's
  address into it. `@pidgeon-ai/sdk/verdict`: `verifyVerdict` checks one
  offline against Pidgeon's keys; `pidgeon.checkVerdict` checks and spends
  one with Pidgeon (`/v1/verify/verdict`). `@pidgeon-ai/sdk/next`:
  `verdictFor` gets one in a proxy, on the sign-up's own request.

## 2.7.0

- `pidgeon.keys`: `list`, `create` and `revoke` API keys (`/v1/keys`). A key is
  never stronger than the one making it; a test key makes only test keys.

## 2.6.0

- `verify` answers `result`, one of four: `verified` (a Pidgeon operator's
  agent), `signed_known` (signed with a key from an outside directory on
  Pidgeon's recognised list), `signed_unknown` (an outside directory nobody
  vouches for) or `refused`. The signed results carry `signature_agent`
  (`directory`, `host`, `operator`). `valid` is unchanged: true for
  `verified` only, so code that reads `valid` behaves as before; outside
  signers still come back `valid: false` with `reason: 'unknown_key'`.
- `verifyAgentRequest` checks signatures as
  draft-ietf-webbotauth-httpsig-protocol-01 writes them: `alg` and `nonce`
  optional, a nonce of any length, and the `web-bot-auth` signature picked
  when a proxy added another. `findKey` is also given the directory the
  signature names. Failed verifications carry `directory`; successful ones
  carry `signature`. `signatureAgentOf(request)` reads a request's directory.

## 2.5.0

- `@pidgeon-ai/sdk/next`: `bouncer({ apiKey })` for a Next.js proxy (or any
  `Request` with `waitUntil`). Observe mode checks each request carrying an
  agent's signature, or `Signature-Agent` alone, with `POST /v1/verify` after
  the response; it never throws, delays or changes a response, skips other
  requests and CORS preflights, and leaves out the visitor's `Cookie` and
  `Authorization` unless signed. No key: it does nothing.
- `sites.update(clientId, { name, redirectUris })` and
  `sites.rotateSecret(clientId)`: edit a site, and give it a new secret
  (answered once; the old one stops working at once).
- `verifyAgentSignIn` requires the request's `Signature-Agent` to be the
  agent's own directory (the token's `agent.directory`), as Pidgeon's token
  exchange now does: `wrong_directory` otherwise.
- `SignInError.reason` says which: `wrong_request` (signed for another
  method, path or host) and `expired` (the signature is too old or dated
  ahead) are no longer reported as `wrong_key`.
- `verifyAgentSignIn` takes `clientSecret`: a token issued under a mandate is
  checked with Pidgeon's `/oauth/introspect`, and one whose mandate was
  stopped is refused at once (`mandate_ended`), not when the token expires.
- `sameDirectory(named, directory)`. `PidgeonClaims` has `act`, `mandate`,
  `scope` and `agent.directory`.

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
