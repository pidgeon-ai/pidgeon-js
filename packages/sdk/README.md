# @pidgeon-ai/sdk

Email inboxes for AI agents. Give each agent its own address on
@pidgeon.email or your own domain, or give every user of your platform inboxes
of their own. Plus Sign in with Pidgeon. https://pidgeon.ai

```sh
npm install @pidgeon-ai/sdk
```

Version 2 is for the new Pidgeon. Code written for 1.x (the old email API at
`/api/v1`) keeps working on 1.68.0 until that API is retired.

## Give an agent an inbox

```ts
import { Pidgeon } from '@pidgeon-ai/sdk';

const pidgeon = new Pidgeon({ apiKey: process.env.PIDGEON_API_KEY! });

const inbox = await pidgeon.inboxes.create({ name: 'bookings' }); // bookings@pidgeon.email
await pidgeon.messages.send(inbox.id, {
  to: ['ana@example.com'],
  subject: 'Table for two',
  text: 'Friday at 8?',
});

// Wait for the reply (up to 50 seconds a call):
const { data: replies } = await pidgeon.messages.await(inbox.id);
```

On your own domain, pass `domain` once mail is on for it
(`pidgeon.domains.enableMail`).

## Email

```ts
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

## For platforms

Give every user of your platform inboxes of their own, white-labelled on their
own domain. Each user gets a pod; a key of that pod reaches only its mail.

```ts
const pod = await pidgeon.pods.create('Acme Ltd');
// acme.com is the user's domain, with mail on, in their pod.
const inbox = await pidgeon.inboxes.create({ name: 'support', podId: pod.id, domain: 'acme.com' });
const { key } = await pidgeon.keys.create({ name: 'Acme', access: 'send', podId: pod.id });
```

## Sign in with Pidgeon (`@pidgeon-ai/sdk/auth`)

Agents sign in to websites as themselves, with a key of their own.

### Set an agent up

```ts
// Registers the agent, makes its key here, and publishes the public half
// signed with it. Keep key.privateJwk where the agent runs: Pidgeon never sees it.
const { agent, key } = await pidgeon.agents.setUp({
  name: 'Booking agent',
  purpose: 'Books tables.',
});
```

From a terminal or a coding agent, `@pidgeon-ai/cli` and `@pidgeon-ai/mcp`
do the same, and keep the key in a file on your machine
(`@pidgeon-ai/sdk/node`: `setUpAgent`, `agentFromKeyFile`).

### Sign its requests

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

### Your site

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
