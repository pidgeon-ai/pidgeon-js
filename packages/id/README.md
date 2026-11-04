# @pidgeon-ai/id

A signed identity for your AI agents, on your own domain. Free, no account,
and checkable by anyone. Then the open library your agents sign with: email
through any provider, HTTP requests, and MCP calls.

```bash
npx @pidgeon-ai/id init acme.com
npx @pidgeon-ai/id issue support-agent
```

With [`@pidgeon-ai/cli`](https://www.npmjs.com/package/@pidgeon-ai/cli)
installed, the same commands are `pidgeon id init` and `pidgeon id issue`.

## What happens

1. **`init acme.com`** makes an Ed25519 key on this machine. It never leaves
   it: Pidgeon only ever sees the public half. You add one TXT record, which
   proves the domain is yours and names your key:

   | Type  | Name    | Value                    |
   | ----- | ------- | ------------------------ |
   | TXT   | `_post` | `v=post0; id=<your id>`  |
   | CNAME | `post`  | the target `init` prints |

   The CNAME makes `post.acme.com` serve your keys and your agents' cards to
   anyone. Without it Pidgeon's verifier still checks your agents, and nobody
   else can. Where your DNS provider offers Domain Connect, `init` prints a
   link that adds both in one click.

2. **`issue support-agent`** gives `support-agent@acme.com` an agent card: a
   JWS, signed by Pidgeon as the issuer that checked your domain, saying who
   the agent is, which domain operates it, and which key signs for it. It is
   live at `https://post.acme.com/.well-known/post/card?address=support-agent@acme.com`.

3. **It renews itself.** A card is signed for a day each time it is read,
   for as long as the `_post` record stands. Take the record down and the
   cards stop.

`list`, `revoke <name>` and `rotate` do what they say. A revoked card is gone
at once; a copy somebody already fetched lapses within a day. After `rotate`,
mail signed with the old key still verifies for a day.

Keys live in `$PIDGEON_ID_DIR` (default `~/.config/pidgeon/id`), one file per
domain, readable by you only. On a server, set `PIDGEON_ID_KEY` to
`<domain>:<seed>` from that file instead.

## Signing

```ts
import { loadIdentity, signEmail, signedFetch } from '@pidgeon-ai/id';

const identity = await loadIdentity('acme.com');
const agent = 'support-agent@acme.com';

// Email, through any provider that lets you set a header.
const { headers } = signEmail(identity, {
  from: agent,
  to: ['customer@example.com'],
  subject: 'Your refund',
  text: 'Your refund of £42 is on its way.',
});
// Send `headers['Post-Envelope']` with the message, and the same `text` as its text/plain part.

// HTTP: every request signed (HTTP Message Signatures, the Web Bot Auth profile).
const fetchAsAgent = signedFetch(identity, { agent });
await fetchAsAgent('https://api.vendor.example/v1/refunds', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ order: 'A-1' }),
});
```

**MCP** over Streamable HTTP is HTTP, so the same `fetch` signs every call:

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { loadIdentity, signedFetch } from '@pidgeon-ai/id';

const identity = await loadIdentity('acme.com');
const transport = new StreamableHTTPClientTransport(new URL('https://mcp.vendor.example/mcp'), {
  fetch: signedFetch(identity, { agent: 'support-agent@acme.com' }),
});
await new Client({ name: 'support-agent', version: '1.0.0' }).connect(transport);
```

What a request signature covers: the method, host, path and query, the
`Signature-Agent` (`https://post.acme.com`), the agent's address as `From`,
and the body's `Content-Digest`. It is good for five minutes. `keyid` is the
key's JWK thumbprint and the tag is `web-bot-auth`, so Cloudflare's Web Bot
Auth verification reads it too.

**A2A**: put the identity in your agent's A2A Agent Card, signed with the
same key (`jku` points at `post.acme.com`'s key directory):

```ts
import { loadIdentity, signA2aCard, type A2aAgentCard } from '@pidgeon-ai/id';

declare const agentCard: A2aAgentCard; // your /.well-known/agent-card.json
declare const postCard: Parameters<typeof signA2aCard>[2]; // what `issue --json` printed

const identity = await loadIdentity('acme.com');
const signedCard = signA2aCard(identity, agentCard, postCard);
```

`verifyA2aCard` is the other side.

## Checking

Anyone can check what your agent signed, with no key:

```bash
curl -s https://pidgeon.ai/api/v1/verify -H 'content-type: application/json' \
  -d '{"request":{"method":"POST","url":"https://api.vendor.example/v1/refunds","headers":{"...":"..."},"body":"..."}}'
```

Send `message` (the raw email) or `request` (the method, URL, headers and
body as received). The answer is a `verdict`, the agent's address, the
domain that operates it, and its card. An MCP server can also check a request
itself with `verifyRequest`, given the key from `post.<domain>`.

The formats are Post's, an open protocol: [pidgeon-ai/post](https://github.com/pidgeon-ai/post).

Apache-2.0.
