# Changelog

Versioned independently of the application. The API is `/v1`; this package
is `1.x`. They are different contracts with different audiences, and tying
the two would publish a release for every unrelated product deploy.

Semver applies to **this package's own surface** — the exported names, the
call shapes, the result shape — not to the API behind it.

## 1.31.3 — take a cursor first

Descriptions only. `messagesAwait` now says how to wait for mail you are
about to cause: call with `after: 'now'` and `timeout: 1`, keep the
`cursor`, submit the form or send, then wait with that cursor as `after`.
No shape moves.

## 1.31.2 — the client names itself

Outside a browser the default client now sends `User-Agent: @pidgeon-ai/sdk`
on every request, so Pidgeon can tell an account made through the SDK from
one made with a hand-written `fetch`. A header you set yourself still wins.
In a browser nothing changes: the browser sets its own. The Python client
does the same as `pidgeon-python/<version>`.

## 1.31.1 — inbox, address, folder

Descriptions only. Where the docs said "mailbox" they now say inbox (what an
agent or a person has), address (`name@domain`, which the API calls an
identity) or folder. Every name stays: `mailboxes.list`, `/v1/mailboxes`,
`identity_id`. No shape moves.

## 1.31.0 — `receive_policy`

Every address carries `receive_policy`: `open` (anyone, the default) or
`list`, which accepts only senders with an `inbox` receive rule on mail that
passes DMARC and refuses everybody else before anything is stored.
`identitiesUpdate` sets it; `identitiesReceiveRulesList` and
`identitiesReceiveRulesCreate` return it beside the rules. Additive.

## 1.30.0 — `authentication.signature`

A message carries `authentication.signature`: `pass` when it came from
another Pidgeon address directly and its signed sender verified against the
sending domain's key, null otherwise. Additive.

## 1.29.0 — The signed-sender records

Every domain's DNS records (`domainsGet`, `domainsCreate`, `domainsVerify`)
gain two optional ones: `signing`, a TXT at `_post`, and `signing_host`, a
CNAME at `post`. With both connected, mail from the domain carries a
signature receivers can check against the domain's published keys. Every
record gains `optional`, true for these two; they have their own `status`
and never count towards whether the domain is configured. Additive.

## 1.28.0 — DNS hosts for subdomains, and why a record is waiting

Every DNS record (`domainsGet`, `domainsCreate`, `domainsVerify`) gains
`zone`, `fqdn` and `host_relative`: for `agents.example.com` the DMARC record
is `_dmarc.agents` in `example.com`, which is what Squarespace, GoDaddy and
Namecheap ask for. `name` is unchanged. `state` says why `status` is what it
is — `published` (correct in DNS, waiting on Amazon), `missing`,
`wrong_value` or `wrong_name` — and `found_at` is where a misplaced record was
found. For DKIM, `found` is now the CNAME read from DNS rather than Amazon's
status word. Additive.

## 1.27.0 — a key that drafts and never sends

`keysCreate` takes `access: 'draft'`, between `read` and `send`: the key
reads, searches, labels, archives, trashes, updates and hands off threads,
and creates, updates and deletes drafts. Every send, reply, forward, draft
send, schedule, calendar write and app password answers `403`. `access` on a
key, `me` and mailbox access can now be `'draft'`. Additive.

## 1.26.0 — provisioning and teardown by pod

`podsCreate` takes `address` (the same fields as `identitiesCreate`) and `key`
(`name`, `access`, `expires_at`, `test`), and makes the pod, that address in
it and a pod key in one call, or none of them. It answers `PodCreated`: the
pod with `address` and `key`, each null when not asked for. The key's `token`
is there once; a replay with the same `Idempotency-Key` returns the same pod,
address and key with `token: null`. `podsDelete` (`DELETE /pods/{id}`) revokes
the pod's keys and deletes its addresses and all their mail, and needs
`delete_addresses: 'true'` for a pod that holds any. `keysList` takes
`pod_id`. Additive.

## 1.25.0 — a forged `from` is held back

`messagesAwait` with `from` matches only mail that passed DMARC (or that
Pidgeon delivered between its own addresses), because anybody can write a
`From:`. A match that did not is counted in `held_back.unauthenticated`, and
its id is in `held_back.message_ids`; `include_unauthenticated: 'true'`
returns it. A behaviour change for a sender that publishes no DMARC record.

## 1.24.0 — test mode

`keysCreate` takes `test: true` for a `pgn_test_` key: everything works, and
nothing it sends leaves Pidgeon or counts against the plan. A test key's
children are test keys. Every key, message and send answer (`messagesSend`,
`messagesReply`, `messagesReplyAll`, `messagesForward`, `draftsSend`) has
`test`. `testInbound` (`POST /test/inbound`) delivers a simulated message to
one of a test key's addresses, optionally as a reply (`in_reply_to`). A test
key gets `403` creating addresses, domains, pods or app passwords. Additive.

## 1.23.0 — rotating a key

`keysRotate` (`POST /api-keys/{id}/rotate`) gives a key a new secret and
keeps its id, so its scope, its ceiling, its expiry and every key it minted
are unchanged and keep working. The old secret stops at once, or after
`grace_period_seconds` (at most 86400). The answer carries the new `token`,
once. Every key gains `rotated_at` and `previous_token_expires_at`. Additive.

## 1.22.0 — typed data, and the declared sender

Every send — `messagesSend`, `messagesReply`, `messagesReplyAll`,
`messagesForward`, and `draftsCreate` and `draftsUpdate` for a draft sent or
scheduled later — takes an optional `data: { schema, body }`: `schema` is an
http or https URL naming what `body` is, and `body` is up to 64 KB of JSON.
It travels as its own part beside the text, which ordinary mail clients do
not show, and comes back as `data` on the message, on a Pidgeon recipient's
copy and on any received mail that carries one. It is never mixed into
`text`, and the Firewall does not read it as prose.

Every message has `sender: { address, kind, on_behalf_of }`. A message sent
from Pidgeon declares `kind` (`person`, `agent` or `service`, from the
address's type) and `on_behalf_of` (the workspace's name, which only an owner
can change). Mail that arrived as ordinary email declared neither, and
says `origin: "smtp"`; `authentication` is what is known about it.
`message.sent` carries `sender` too. Additive; nothing narrows.

## 1.21.0 — every send takes a key, and receipts

`Idempotency-Key` is a declared header on every operation that honours it,
so each takes `headers: { 'Idempotency-Key': … }` typed rather than as a
raw header. It is honoured now on every send: `messagesReply`,
`messagesReplyAll`, `messagesForward`, `draftsSend`, `draftsSchedule`,
`calendarCreateEvent`, `calendarUpdateEvent`, `calendarDeleteEvent`,
`calendarRespondToEvent` and `messagesRespondToInvitation`, beside
`messagesSend` and the creates that had it. The same key with the same
request returns the first answer and sends nothing; with a different
request, `409`. Reuse one key across your own retries of one send.

Two event types, both receipts from a Pidgeon address you wrote to:
`message.read` (its agent read the message through the API, the first
time — only from an address with the new `readReceipts` capability, off by
default) and `message.handed_off` (it handed the conversation to a person).
Each carries `message_id`, `recipient`, `kind` and `at`, and is
subscribable like any other. Additive; nothing narrows.

## 1.20.0 — a wait looks back before it waits

`messagesAwait` with no `after` returns the newest matching message from
the last two minutes before it starts waiting. An agent submits a form and
then asks for the code, and a fast sender's code was already there: the
wait started at "now" and timed out on it. `after` also takes `"now"`, the
old start. A caller that looped without passing `cursor` back may now see a
message twice; pass the cursor, as before.

## 1.19.2 — what `/raw` answers

The description of `GET /messages/{id}/raw` said it 404s once the original
has aged out. It does not: it answers a rebuild from the stored message,
marked `X-Pidgeon-Reconstructed: true`, and received mail is the archived
original until then. Wording only; no shape moves.

## 1.19.1 — the default wait is under a minute

`GET /messages/await` waits 50 seconds when no `timeout` is given, down
from 60. Clients that give up on a request at 60 seconds — the TypeScript
Agents SDK, Claude Code's MCP client — failed the default wait exactly when
no message came. An explicit `timeout` up to 280 behaves as before.

## 1.19.0 — every status is declared, and Python raises

The contract declares every status a route can answer with, read off the
code rather than written from memory: `400`, `403`, `409`, `500` and `503`
on every operation beside the `401`, `404` and `429` it had, `402` where a
plan can say no, and `410` on calendar events and `mailboxesChanges`. In
this package that widens each operation's error type; no request or success
shape changes, and `error` held every failure already.

**The Python client raises.** A status from 400 up raises
`pidgeon.errors.PidgeonError`, carrying `status_code`, `code`, `message`,
`field` and `retry_after`, instead of returning `Error` for a declared status
and `None` for any other. A call returns its success model or raises, so a
refused send can no longer pass for a sent one. Code that checked
`isinstance(result, Error)` sees the exception instead.

**The CLI** (1.8.4) exits 1 on a refusal and prints `403 abuse_blocked: …`;
it exited 2 with the sentence alone, as if the flags were wrong.

## 1.18.0 — the key you mint comes back with its token

`POST /api-keys` is typed as `ApiKeyCreated`: the key plus its `token`,
returned once and never again. The API always sent the token; the published
type left it out, so `keysCreate` had no typed field for it and the Python
client's `ApiKey` model dropped it.

## 1.17.0 — a hand-off says why

`threadsUpdate` takes an optional `reason` (up to 500 characters): why the
conversation is being handed over, shown to the person in their notification
and carried on `thread.updated` and `thread.assigned`.

## 1.16.1 — a refused send says so

The contract declares `400` and `403` on every send — `messagesSend`,
`messagesReply`, `messagesReplyAll`, `messagesForward`, `draftsSend` — and
`409` on `messagesSend`. No request or success shape changes. The Python
client returned `None` for a `403` (a sending limit, a rule, the send
policy) because the status was not in the document; it returns the `Error`
now, so check for it before treating a send as done.

## 1.16.0 — an attachment as text

`attachmentsText` (`GET /attachments/{id}/text`) returns a text attachment —
CSV, log, JSON, calendar — as text, up to 5 MB and 200,000 characters, with
a Pidgeon Firewall verdict judged with the message's sender. `body: 'clean'`
returns the cleaned text. HTML, PDF, Office files and images are refused.

## 1.15.0 — a read says what it held back

`GET /messages/await` returns `held_back`: matching messages that arrived
and were filed as spam, by count and id, so a wait that times out on a code
from a sender whose authentication failed no longer reads as "nothing came".
`include_spam=true` returns such a message instead. The inbox page of
`GET /mailboxes/{folder}` carries `held_back.spam`, the unread messages in
Spam, because an inbox that looks empty may not be.

## 1.14.2 — the PyPI page is the Python README

No change to the API or the exported surface. Released with the Python
client, whose PyPI page is now its own README rather than a shorter copy.

## 1.14.1 — the README leads with the job

No change to the API or the exported surface. The README opens with
creating an address, sending, waiting for the answer and replying with
`messagesReply`, and the package's description and keywords say what it is
for: email inboxes for AI agents.

## 1.14.0 — clean bodies in a conversation

`body=clean` on `GET /messages`, as on `GET /messages/{id}` and
`/messages/await`: every message in the conversation comes back with
Pidgeon Firewall's `clean_text` as its text and empty HTML. The MCP
`list_messages` tool asks for it by default. And a message the Firewall
calls suspicious is stored with a preview cut from its cleaned text, so a
hidden instruction no longer shows in search results or folder listings.

## 1.13.0 — what the agent reads

`firewall.clean_text` on every inbound message: the new text with hidden
content and invisible characters removed, and lines posing as a chat turn
marked, under a one-line note saying what changed. `body=clean` on
`GET /messages/{id}` and `GET /messages/await` returns it as `text` and
`reply_text`, with `html` and `reply_html` empty. The default is still
`original`. The MCP server and the AI SDK ask for `clean` unless told
otherwise.

## 1.12.0 — Pidgeon Firewall

Every inbound `Message` carries `firewall`: a `verdict` (`clean` or
`suspicious`) and the `signals` that produced it — hidden text, instructions
addressed to an AI, impersonated chat turns, directives buried in quoted
history, look-alike senders, display-name spoofing, and requests to send
secrets out — each with where it fired and a sentence quoting it.
`message.received` carries the verdict and the signal kinds. Observe-only:
nothing is held or changed. Read it before acting on what a message asks.

## 1.11.0 — a key for one pod

`apiKeysCreate` takes `pod_id` in place of `identity_ids`: the key reaches
every address in that pod, including ones added later, and may create,
verify and remove that pod's domains — the key a platform hands one of its
customers. Only a key over the whole account (or an owner, in the dashboard)
can mint one. Every key now reports `pod_id`, null for keys that are not
pod keys.

## 1.10.0 — events over a WebSocket

`GET /v1/events/socket` is the event log over a WebSocket, with the same
filters and `after` cursor as the stream. The generated `eventsSocket` can
only show you the contract — open it with a WebSocket client
(`new WebSocket('wss://pidgeon.ai/api/v1/events/socket')`) and send
`{"type":"auth","api_key":…}` first if you cannot set a header. The
protocol is in the reference.

## 1.9.0 — export over the API

**`exportMail`** (`GET /v1/export`) streams every message the key can read as
one `application/mbox` file — the export the dashboard has always offered,
now for software. Pass `identity_id` for one address. Each message carries
`X-Pidgeon-Mailbox`, so one file holding several addresses can be split
again. Four an hour per workspace.

## 1.8.0 — wait for a message, and read the code out of it

**`messagesAwait`** (`GET /v1/messages/await`) holds the request open until a
message matching your filters arrives at an address — `from`, `subject_contains`,
`has_code` — or `timeout` seconds pass, up to 280. It answers
`{ message, timed_out, cursor }`; pass `cursor` back as `after` so a message
arriving between two calls is never missed. One call where an agent waiting
for a sign-up code used to write a polling loop.

**Every `Message` carries `extracted`**: `codes` and `links`, most likely
first, each with its kind. Candidates rather than one answer, because
extraction is a heuristic — take the first, and when it fails the second is
right there. Read from the new text, never the quoted history.

## 1.7.0 — a pod's reputation you can see

`GET /metrics` takes `pod_id`, and its window carries `pod` and `reputation`.
1.6.0 claimed each pod had its own sending reputation and gave no way to
check it; this is the check. `/metrics` also rejects an unknown query
parameter instead of ignoring it, so a caller passing a misspelt filter is
told rather than answered for the whole account.

## 1.6.0 — a pod is a boundary now

**No field changed.** What changed is what a pod means, and that is worth a
release because 1.5.0's own description told you the opposite.

**Each pod has its own sending reputation.** Bounces and complaints from one
customer's mail are counted against that customer's pod and nothing else, so
one bad tenant cannot degrade delivery for the rest. Mail from an address in
a pod sends under that pod whichever domain it is on, so two pods sharing one
domain are still separate.

1.5.0 said _"a pod carries no sending reputation of its own"_, which was true
and is not. Leaving it would be the worse kind of stale documentation — a
caller reading it would decline to use something they already have.

A pod is still **not** a key scope. A key is a list of address ids, which is
what makes its reach checkable.

## 1.5.0 — a container your customers live in

**Additive.** Every account has exactly one pod already, every address is in
it, and a caller who never mentions a pod cannot tell this release from the
last one.

**Added.** `podsList`, `podsCreate`, `podsGet`, `podsUpdate`, the `Pod` type,
`pod_id` on an address, and `pod_id` as a filter on `identitiesList`.

A **pod** holds addresses and domains: one of your customers, a client, or
just test kept apart from production. It has a name and an optional
`client_id` that is your own id for it, carried and never parsed.

**It is organisational and not a boundary**, and the types say so because the
risk in shipping the container before the isolation is a reader assuming the
isolation. A pod carries no sending reputation of its own — one SES tenant
per _account_, unchanged — and **a key is still a list of address ids**,
never something scoped to a pod.

**No delete.** The verb that destroys a container full of mailboxes is worth
making somebody ask for, and nothing yet moves addresses between pods, so it
would either refuse every non-empty pod or destroy mail.

## 1.4.0 — things the prose promised and the types did not have

**Additive, and two corrections to descriptions that were wrong.**

The rest of what a field test found on 15 October building a shared mailroom.
Everything below was either returned and undeclared, or described in the
documentation and absent from the product.

**Added to `Message`.**

- `headers`, which `skill.md` and the MCP `get_message` tool have both
  promised for months — "its body **and its headers**" — against a schema
  with no such property. It is a subset and the description says which:
  `message-id`, `in-reply-to`, `references`, `date`, `reply-to`,
  `return-path`, the four list and auto-reply headers, `x-mailer` and
  `x-priority`. The whole envelope is `GET /messages/{id}/raw`. The
  threading three are new to the kept set, because _will my reply land in
  the right conversation_ is the question people open this for and nothing
  answered it for mail between two Pidgeon addresses.
- `authentication` — `spf`, `dkim`, `dmarc`. `/docs/rules` has said since it
  was written that if you need to be certain who sent something you should
  _"read the authentication results on the message rather than its `From:`"_.
  There were none in the contract: no such field anywhere. The columns have
  been written since inbound mail existed. **Null means not reported, not
  failed** — rendering an absent verdict as a failed one is worse than
  showing nothing.
- `delivered_to` is the envelope recipient on every message. It was null
  unless routing had moved the mail, while `message.received` carried it
  every time, so the event and the read disagreed about the same message.

**Added to `Thread`.** `folder`, `from`, `from_name`, `preview` and
`has_attachments`, from the newest message. `GET /threads` is the only
workspace-wide listing and a row could say which conversations exist without
being able to draw one — so a merged inbox had to come from
`GET /mailboxes/{folder}`, which takes one address and one folder. Three
addresses and four folders is twelve calls for one screen, against a free
plan's 120 requests a minute. It is one call now.

**Added to `MailboxChange`.** `identity_id`, which was null on every row of
the only endpoint whose first required parameter is the mailbox.

**New error codes.** `blocked` and `not_permitted`, both `403`.
`/docs/rules`: _"a refusal tells you which kind it was… an agent debugging a
send needs to know which."_ Both answered `forbidden` and neither word
appeared in the response, so the only way to tell was to match the sentence.
The fix is different for each — remove a rule, or change the send policy —
which is the whole reason to separate them.

**Corrected.** Two descriptions that described something the API does not do:

- `rejected` on a send is **what the provider would not accept at hand-off**,
  not a recipient your own rules forbid. That refuses the whole send with
  `403`, and nothing goes to anybody. The old sentence told callers to handle
  a partial send that never happens, and not to expect the exception they
  actually get.
- `is_read` on `PATCH /messages/{id}`, and `read`/`unread` on
  `POST /messages/actions`, are declared refused for an API key. They always
  were — read state belongs to a person — but three surfaces advertised them
  with no hint, including the MCP tool, whose description argued for a
  capability it does not have to the one consumer that cannot check first.

**Widened.** `colour` on a label now has to be one of the eight; the
refusal's sentence is unchanged.

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
