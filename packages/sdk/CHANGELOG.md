# Changelog

Versioned independently of the application. The API is `/v1`; this package
is `1.x`. They are different contracts with different audiences, and tying
the two would publish a release for every unrelated product deploy.

Semver applies to **this package's own surface** — the exported names, the
call shapes, the result shape — not to the API behind it.

## Unreleased

## 1.3.0 — a day of API that never reached a registry

**Additive, and one fix that was a blocker.**

1.2.0 went out on 14 October and then the contract moved for a day without
this number moving with it. A field test on 15 October installed the published
package, called a search the live API had been accepting since the morning,
and got a `TypeError` for an argument the contract no longer requires. It
built what it needed with a hand-written HTTP client instead. Everything below
had already shipped; none of it was installable.

**Fixed.** `verifyWebhook` reads the signature headers whatever case the
framework spells them in. The lookup was `headers[name] ?? headers[name
.toLowerCase()]` and `name` is already a lowercase constant — so it read the
same key twice, and a plain object keyed `X-Pidgeon-Signature` was rejected as
unsigned. Every existing test passed, because they all hand it a `Headers` or
a lowercase object and both are already normalised. The broken branch is
reached by an object somebody built themselves, which is what API Gateway
hands a Lambda. `pidgeon` on PyPI was always right about this.

**Added.**

- `meGet`. What a key is, what it may do, and how many addresses it reaches —
  the first call a credential can make about itself.
- `eventsStream`'s endpoint is in the document. The client does not wrap SSE,
  because a generated client has nowhere to put a long-lived connection; the
  path, the cursor header and the event shape are typed so hand-rolling it is
  twenty lines rather than a reverse-engineering exercise.
- `thread.created` is emitted and subscribable. It was declared, accepted by
  `POST /webhooks`, and had never once fired.
- `from_self` on `message.received`. A workspace with several addresses sees
  its own outbound mail arrive at the others, genuinely inbound, with nothing
  to distinguish it from a stranger — so a handler written the obvious way
  answers its own reply. Check it before you reply.
- Quota pacing on a refusal: `Retry-After` and `X-RateLimit-*-Day`, so a
  client refused a send can compute when it may try again instead of guessing
  a day.

**Declared, having always been returned.** Three fields the API sends and the
document did not mention, so the generated types dropped them and a caller had
to cast to reach them:

- `sync_cursor` on a folder listing. `GET /mailboxes/changes` documents
  `since` as "the `sync_cursor` from a listing" and no listing declared one,
  so the change feed was unreachable from a typed client without defeating
  its own types.
- `folder` on a search hit, and `identity` beside `identity_id` — the address
  rather than the uuid, which is what the rest of the API already carries on a
  thread row, on an event and on `GET /messages/{id}`. A search is the one
  endpoint that spans mailboxes, so it was the one that most needed to name
  them and the only one that would not. A hit is now its own type,
  `SearchHit`, rather than a `MessageListItem` with two fields missing.
- `colour` is the eight-value enum it has always been enforced as, not
  `string`. The palette existed only in the refusal, so the first call
  anybody writes fails — somebody who has written CSS passes a hex. The
  refusal was already good and is kept word for word.

**Widened.** `messagesSearch` no longer requires `identity_id`. It searches
every address the credential reaches, which is what it has always done on the
server and what `skill.md` has always said; the document said "one mailbox at
a time" in prose while declaring the parameter optional, and the generator
followed the prose. `MessageListItem` carries `identity_id`, `to`,
`counterparty` and `counterparty_name`, so a hit can be attributed to a
mailbox without a second call.

**Also.** `identitiesCreate` on the shared domain, a 404 that stopped
pretending an address it had just listed did not exist, and `repository`
fields that resolve — all four packages pointed at a private repository that
404s for everybody who installs one.

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
