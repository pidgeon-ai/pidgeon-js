# Changelog

Versioned independently of the application. The API is `/v1`; this package
is `1.x`. They are different contracts with different audiences, and tying
the two would publish a release for every unrelated product deploy.

Semver applies to **this package's own surface** — the exported names, the
call shapes, the result shape — not to the API behind it.

## Unreleased

## 1.2.0 — the document says what its fields mean

**Additive, and a correction.**

**Added.** Every request field that means one thing everywhere now carries a
description, so the types say what `from`, `to`, `attachment_ids` and twenty
others are for — 0 of 136 had one before.

**Corrected.** `messagesSend` is typed `Sent` at `202`, which is what the API
has always answered. It was declared `Message` at `201`, a response that never
arrives — so a caller reading `data.subject` off a send got `undefined`, and
`send` and `reply` appeared to disagree about their shape when they never did.
Minor rather than major because nothing could have depended on a status code
the server does not send.

## 1.1.0 — the domain an address is on

Additive. Nothing here changes a call that already works.

**Added**

- `Identity.domain_id`. Every address now says which domain it is on, not
  only its name. This exists because the id was otherwise unlearnable: an
  account whose only domain is the shared one gets `[]` from `GET /domains`,
  correctly — that endpoint lists what a workspace _owns_ — and `domain_id`
  is what `identitiesCreate` requires. A customer building against production
  read the uuid out of the database to get past it.
- `identitiesCreate` takes `domain` (a name) or `address` (a whole one) in
  place of `domain_id`. Pass exactly one. `address` also supplies the local
  part, which is the form `skills/pidgeon/SKILL.md` has documented since it
  was written.
- `threadsList` takes `identity_id`, `status`, `owner_type` and
  `assignee_id`. The API has honoured all four since it was written and the
  contract declared none of them, so no generated client could offer them.
  `assignee_id` takes a person's id or the literal `unassigned`.

## 1.0.0 — one name per operation, generated

**Published without an entry here**, which is how a changelog stops being
read. Recorded after the fact, on 13 October, when a customer found the
package README describing a class the package does not export.

**Breaking.** The hand-written client is gone. There is no `Pidgeon` class
and no `PidgeonError`: the package is generated from `openapi.json`, one
function per operation named for its tag — `messagesSend`, `messagesGet`,
`threadsUpdate` — sharing one client you configure at startup with
`client.setConfig`. A call resolves to `{ data, error }` rather than
throwing, or pass `throwOnError: true`.

Both clients are generated from the same document, so an operation has the
same name in TypeScript and in Python. `decisions.md` §343 is the argument,
including why the stutter in `messagesSend` is accepted.

## 0.2.0 — the mailbox, and the credentials to reach it

A minor rather than a patch, because one signature changed. In `0.x` semver
that is what a minor is for, and the alternative — leaving the old shape
beside the new one — would have shipped two ways to search that disagree
about what the second argument is.

**Breaking**

- `messages.search(identityId, q, options)` is now
  `messages.search(identityId, options)`, with `q` inside the options beside
  six filters. Search takes more than words now, and a positional query in
  front of an options bag would have been the only parameter in the client
  that works that way.
- `messages.update` no longer accepts `is_read` from an API key — the field
  is still in the type, is still readable, and the API refuses to set it.
  Read state belongs to a person and a key is not one; it used to return
  `200` and change nothing, which is worse. Archive the conversation, or
  track what you have seen with `mailboxes.changes`.

**New resources**

- `mailboxes` — `list`, `list_folder`, `changes`, `empty_trash`. The folders
  with their counts, one folder by keyset cursor, what changed since a marker,
  and emptying the trash.
- `routing` — `list`, `create`, `update`, `delete`. Per-customer addresses,
  delivered into an inbox you already have or into a webhook with no inbox
  at all.
- `keys` — `list`, `create`, `revoke`. A key can mint a narrower key, and
  revoking one revokes everything it minted.
- `appPasswords` — `list`, `create`, `revoke`. Working IMAP and SMTP
  credentials for one address, which is how you hand a customer a mailbox
  they can open in a mail client.
- `workspace.get` — which account this key is for, and the plan that sets its
  limits.

**New on what was already there**

- `domains` gained `create`, `get`, `verify` and `delete`. `create` returns
  the records to publish alongside the domain, because showing them to your
  own customer is the one thing every caller does next.
- `webhooks` gained `update` (enable and disable), `deliveries` and `replay`.
- `attachments.upload`, and `html` and `attachment_ids` on `messages.send`.
- `messages.act`, `messages.undo`, `threads.update`.

**New types** — `ApiKey`, `AppPassword`, `Delivery`, `DnsRecord`, `Mailbox`,
`MailboxChange`, `Member`, `MessageActionName`, `MessageListItem`,
`UploadedAttachment`, `Workspace`. `RoutingRule` gained `domain_id` and
`destination_id`, and its `match_type` documentation said `exact`, which was
never a value the API emits.

## 0.1.0

First release.

- `Pidgeon` — a typed client over `/v1`: `identities`, `messages`,
  `attachments`, `threads`, `webhooks`, `events`, `domains`.
- `verifyWebhook` — the receiving half of the signature scheme, tested
  against payloads signed by the server's own implementation.
- `PidgeonError` — one error class, carrying the API's `code`, HTTP
  `status`, the offending `field` on a validation failure, and the request
  id.
- ESM and CommonJS builds with per-condition type declarations. Zero
  runtime dependencies; needs only `fetch` and `crypto.subtle`.
