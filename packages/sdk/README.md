# @pidgeon-ai/sdk

Pidgeon's TypeScript SDK for its four products: Passport (your agents' keys
and reputation), Bouncer (verify agents at your site), Email (inboxes for
agents) and Auth (Sign in with Pidgeon). https://pidgeon.ai

```sh
npm install @pidgeon-ai/sdk
```

Version 2 is for the new Pidgeon. Code written for 1.x (the old email API at
`/api/v1`) keeps working on 1.68.0 until that API is retired.

## Set an agent up

```ts
import { Pidgeon } from '@pidgeon-ai/sdk';

const pidgeon = new Pidgeon({ apiKey: process.env.PIDGEON_API_KEY! });

// Registers the agent, makes its key here, and publishes the public half
// signed with it. Keep key.privateJwk where the agent runs: Pidgeon never sees it.
const { agent, key } = await pidgeon.agents.setUp({
  name: 'Booking agent',
  purpose: 'Books tables.',
});

const { reputation } = await pidgeon.agents.get(agent.id);
reputation.band; // unverified, new, good, flagged or suspended
```

From a terminal or a coding agent, `@pidgeon-ai/cli` and `@pidgeon-ai/mcp`
do the same, and keep the key in a file on your machine
(`@pidgeon-ai/sdk/node`: `setUpAgent`, `agentFromKeyFile`).

## Sign your agent's requests

```ts
import { agentFromEnv } from '@pidgeon-ai/sdk';

// PIDGEON_AGENT_KEY is the private JWK, PIDGEON_DIRECTORY the agent's directory.
const agent = agentFromEnv();
await agent.fetch('https://shop.example/api/orders', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ sku: 'tea' }),
});
```

Each call is signed afresh: the signature covers the host, method, path and
query, carries a new nonce, and lasts a minute. Pidgeon accepts a signature
once, so sign again to retry; never resend old signature headers.

## Verify an agent at your site (Bouncer)

```ts
const answer = await pidgeon.verify(request);
if (answer.valid && answer.reputation.band !== 'suspended') {
  // answer.agent, answer.operator
}
await pidgeon.report({ verificationId: answer.verification_id, category: 'spam', evidence: '…' });
```

### In a Next.js proxy (`@pidgeon-ai/sdk/next`)

```ts
// proxy.ts (middleware.ts before Next.js 16)
import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server';
import { bouncer } from '@pidgeon-ai/sdk/next';

const observe = bouncer({ apiKey: process.env.PIDGEON_API_KEY }); // read access is enough

export function proxy(request: NextRequest, event: NextFetchEvent) {
  observe(request, event); // returns at once, never throws
  return NextResponse.next();
}
```

Observe mode checks every request that carries an agent's signature (or
claims to be an agent with `Signature-Agent` alone) after the response, with
`waitUntil`: no visit is slowed, blocked or changed, even when Pidgeon is
down. Requests without agent headers and CORS preflights are never sent, nor
the visitor's cookies. Without a key it does nothing. Options: `url`,
`onAnswer`, `onError`, `timeoutMs`; `enforce` mode is coming. Observe on
public content; enforce only where an agent acts (sign-up, checkout, your
API).

## Email

```ts
const inbox = await pidgeon.inboxes.create({ name: 'bookings', agentId: agent.id });
await pidgeon.messages.send(inbox.id, {
  to: ['ana@example.com'],
  subject: 'Table for two',
  text: 'Friday at 8?',
});

// A person looks first:
const draft = await pidgeon.drafts.create(inbox.id, {
  to: ['ana@example.com'],
  subject: '…',
  text: '…',
});
await pidgeon.drafts.requestApproval(draft.id);

// Wait for mail, read it as the Firewall cleaned it, answer in its conversation:
let since: string | undefined;
for (;;) {
  const { data, next_since } = await pidgeon.messages.await(inbox.id, { since, body: 'clean' });
  for (const message of data) {
    if (message.firewall?.verdict === 'suspicious') {
      await pidgeon.threads.update(message.thread_id, {
        ownerType: 'human',
        status: 'human_review',
      });
      continue;
    }
    await pidgeon.messages.send(inbox.id, {
      to: [message.from.address],
      subject: `Re: ${message.subject}`,
      text: 'On it.',
      replyTo: message.id,
    });
  }
  since = next_since;
}
```

Also `pidgeon.threads`, `pidgeon.labels`, `pidgeon.contacts`,
`pidgeon.attachments` (`upload`, `get`), `pidgeon.calendar`,
`pidgeon.domains`, `pidgeon.appPasswords`, `pidgeon.webhooks`,
`pidgeon.rules`, `pidgeon.suppressions`, `pidgeon.events`, `pidgeon.pods`,
and `pidgeon.request(method, path, …)` for any `/v1` call. A refusal throws
`PidgeonError` with the API's `status` and `code`.

Webhooks: `verifyWebhook(secret, rawBody, request.headers.get('pidgeon-signature'))`.

## Sign in with Pidgeon (`@pidgeon-ai/sdk/auth`)

Register your site with `pidgeon.sites.create({ name, redirectUris })`; ask a
person to let your agent act for them with `pidgeon.mandates.create(…)`.

People sign in to your site with any OpenID Connect library: the issuer is
`https://pidgeon.ai`, with the client id and secret you registered. Check an
ID token with `verifyIdToken(idToken, { clientId })`.

An agent signs in with no person present, and sends its ID token with every
request it signs:

```ts
import { signedFetch } from '@pidgeon-ai/sdk';
import { signInAsAgent } from '@pidgeon-ai/sdk/auth';

const { idToken } = await signInAsAgent({ site: 'site_…', key, directory });
await signedFetch(
  'https://shop.example/api/orders',
  {
    method: 'POST',
    headers: { authorization: `Bearer ${idToken}` },
  },
  { privateJwk: key.privateJwk, directory },
);
```

Your site accepts the request only when it is signed with the key the token
names and its `Signature-Agent` is the agent's own directory, so a copied
token is useless on its own:

```ts
import { verifyAgentSignIn } from '@pidgeon-ai/sdk/auth';

const claims = await verifyAgentSignIn(request, { clientId: 'site_…' });
claims.sub;
claims.agent;
claims.account;
claims.reputation;
```

Under a mandate, pass your site's `clientSecret` too: Pidgeon is asked
whether the mandate still holds, so one the person stopped is refused at
once (`mandate_ended`) rather than when the token expires. A token under a
test mandate (asked with a test key) carries `test: true` and verifies like
any other: refuse it in production.

### For an MCP server that trusts Pidgeon (ID-JAG)

```ts
import { requestIdJag } from '@pidgeon-ai/sdk/auth';

const { idJag } = await requestIdJag({
  audience: 'https://auth.example.com', // the MCP server's authorization server
  clientId: 'https://agent.example.com/oauth/client.json', // your client id there
  resource: 'https://mcp.example.com/mcp',
  key,
  directory,
});
// Present it there: grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer, assertion=idJag.
```

## License

Apache-2.0
