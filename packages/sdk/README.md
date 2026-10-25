# @pidgeon-ai/sdk

Pidgeon is the email inbox API for AI agents. It gives agents their own inboxes
so they can work with emails just like a human. This is its TypeScript client:
one typed function per operation, plus a webhook verifier.

```bash
npm install @pidgeon-ai/sdk
```

Or `pnpm add @pidgeon-ai/sdk`. **Zero dependencies.** Needs `fetch` and
`crypto.subtle`, so it runs on Node 18+, Bun, Deno, Cloudflare Workers and
Vercel functions. ESM and CommonJS.

## Create an address, send, receive, reply

```ts
import {
  client,
  identitiesCreate,
  messagesAwait,
  messagesReply,
  messagesSend,
} from '@pidgeon-ai/sdk';

client.setConfig({ auth: () => process.env.PIDGEON_API_KEY! });

// 1. An address of its own. Any free name on pidgeon.email works with no DNS.
const { data: address } = await identitiesCreate({
  body: { address: 'scout@pidgeon.email', type: 'agent' },
  throwOnError: true,
});

// 2. Send from it.
await messagesSend({
  body: {
    from: address.data.email,
    to: 'ops@example.com',
    subject: 'Staging access',
    text: 'Could you send me the access code?',
  },
  throwOnError: true,
});

// 3. Receive: one held-open request until the answer arrives, up to 60 seconds.
const { data: awaited } = await messagesAwait({
  query: { identity_id: address.data.id, timeout: 60 },
  throwOnError: true,
});

// 4. Reply into the same conversation. Recipients and subject come off the original.
if (awaited.data.message) {
  console.log(awaited.data.message.extracted.codes);
  await messagesReply({
    path: { id: awaited.data.message.id },
    body: { text: 'Thanks, that worked.' },
    throwOnError: true,
  });
}
```

`PIDGEON_API_KEY` is a `pgn_live_…` key. Make one at
[pidgeon.ai/app/developers/keys](https://pidgeon.ai/signup?utm_source=npm&utm_medium=readme&utm_campaign=sdk&next=/app/developers/keys), or
let your agent sign itself up: [pidgeon.ai/skill.md](https://pidgeon.ai/skill.md)
is two calls, and the only thing it needs from a person is a six-digit code.

In production, take a [signed webhook](#receiving-mail) rather than holding a
request open. Documentation: [pidgeon.ai/docs](https://pidgeon.ai/docs) ·
[API reference](https://pidgeon.ai/docs/reference) ·
[OpenAPI](https://pidgeon.ai/openapi.json).

## The shape

**There is no `Pidgeon` class.** Every operation is a function named for its
tag — `messagesSend`, `messagesGet`, `threadsUpdate` — and they share one
client you configure at startup. The Python package is generated from the same
document, so an operation has the same name in both.

```ts
import { client, messagesGet } from '@pidgeon-ai/sdk';

client.setConfig({ auth: () => process.env.PIDGEON_API_KEY! });

const { data, error } = await messagesGet({ path: { id: messageId } });
```

A call resolves to `{ data, error }` rather than throwing: `error` carries the
API's own `code`, a `message` written for a person, and a `field` when one
input was at fault. Pass `throwOnError: true` on a call to get the data
directly and an exception instead.

## Receiving mail

Mail arriving at an address your code owns becomes an event, and your
endpoint is called with a signed payload.

```ts
import { client, messagesGet, messagesReply, verifyWebhook } from '@pidgeon-ai/sdk';

client.setConfig({ auth: () => process.env.PIDGEON_API_KEY! });

export async function POST(request: Request) {
  // Verify first. An unverified payload is an unauthenticated POST that
  // claims a message arrived.
  const event = await verifyWebhook({
    rawBody: await request.text(),
    headers: request.headers,
    secret: process.env.PIDGEON_WEBHOOK_SECRET!,
  });

  if (event.type !== 'message.received') return new Response(null, { status: 204 });

  // The event carries ids, never a body. Exchange one for the content.
  const { data: mail } = await messagesGet({
    path: { id: event.data.message_id as string },
    throwOnError: true,
  });

  // Into the same conversation, threaded in the recipient's client too.
  await messagesReply({
    path: { id: mail.data.id },
    body: { text: 'Got it — someone will be in touch.' },
    throwOnError: true,
  });

  return new Response(null, { status: 204 });
}
```

`rawBody` must be the exact bytes we sent. Parse the JSON _after_
verifying — re-serialising changes key order and the signature will not
match.

`verifyWebhook` throws rather than returning a boolean, because the failure
mode of a boolean is a caller who forgets to check it. It rejects a
timestamp outside tolerance (five minutes by default) before it looks at
the signature, and compares in constant time.

## Handing a conversation to a person

```ts
import { threadsUpdate } from '@pidgeon-ai/sdk';

await threadsUpdate({
  path: { id: threadId },
  body: { owner_type: 'human' },
  throwOnError: true,
});
```

Hand it back by setting `owner_type` to `agent`.

It appears in the web inbox, and `thread.updated` tells whatever was
driving the conversation that it no longer is.

## Errors

A failure comes back in `error`, carrying the API's own `code`, a `message`
written for a person and safe to show one, and the offending `field` on a
validation failure.

```ts
const { data, error } = await messagesSend({ body: { from, to, text } });

if (error) {
  if (error.error.code === 'rate_limited') {
    // Back off. Deliberately not done for you — see below.
  }
  throw new Error(error.error.message);
}
```

`code` is one of `validation`, `unauthenticated`, `entitlement`,
`forbidden`, `not_found`, `conflict`, `rate_limited`, `internal`.

With `throwOnError: true` the same failure is thrown instead and `data` is no
longer `undefined`, which is the shape most call sites want.

## Pagination

List endpoints return a page, not an iterator.

```ts
import { eventsList } from '@pidgeon-ai/sdk';

let cursor: string | undefined;

do {
  const { data: page } = await eventsList({
    query: { limit: 50, cursor },
    throwOnError: true,
  });

  for (const event of page.data) handle(event);
  cursor = page.next_cursor ?? undefined;
} while (cursor);
```

## What this deliberately does not do

No retry policy, no queue, no caching, no auto-paginating iterator. Those
are decisions that belong to your application — an SDK that makes them for
you is one you eventually work around, and an iterator that hides
pagination also hides the rate limit pagination is subject to.

## Options

```ts
import { client } from '@pidgeon-ai/sdk';

client.setConfig({
  auth: () => process.env.PIDGEON_API_KEY!,
  // Point at a local dev server, or a preview deployment.
  baseUrl: 'http://localhost:3000/api/v1',
  // Inject a transport. Useful in tests.
  fetch: myFetch,
});
```

`createClient(createConfig({ … }))` makes a second, independent client, for
code that talks to two accounts; pass it as `client` on a call.

## Versioning

Versioned independently of the API. The API is `/v1`; this package is
`1.x`, and semver applies to its own surface — the exported types, the
method signatures, the error shape. See `CHANGELOG.md`.

## Contributing

This package is generated from [`openapi.json`](https://pidgeon.ai/openapi.json),
the contract the API validates against, and published from
[pidgeon-ai/pidgeon-js](https://github.com/pidgeon-ai/pidgeon-js). A pull
request against generated code cannot be merged as written — the fix belongs
in the schema. [Open an issue](https://github.com/pidgeon-ai/pidgeon-js/issues)
and say what is wrong, or email [support@pidgeon.ai](mailto:support@pidgeon.ai).

MIT licensed.
