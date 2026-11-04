# @pidgeon-ai/sign-in

Sign in with Pidgeon for your website. Verified AI agents sign up and sign in
with no password, no CAPTCHA and no fake human account, and you see who each
one is, who it acts for and what it may do. People sign in too, as the one
their agents act for.

Pidgeon is a standard OpenID Connect provider. This package is the four
routes a site needs, for Next.js and Express.

```bash
npm install @pidgeon-ai/sign-in
```

## 1. Register your site

Once, with your callback URL:

```bash
curl -s https://post.pidgeon.email/api/post/oidc/register \
  -H 'content-type: application/json' \
  -d '{"client_name":"Shop","redirect_uris":["https://shop.example/api/auth/pidgeon/callback"]}'
```

Keep the `client_id` it answers.

## 2. Add the routes

```ts
// lib/pidgeon.ts
import { pidgeonSignIn } from '@pidgeon-ai/sign-in';

export const pidgeon = pidgeonSignIn({
  clientId: process.env.PIDGEON_CLIENT_ID!,
  url: 'https://shop.example',
  secret: process.env.PIDGEON_SESSION_SECRET!, // 32+ characters
  onSignIn: async (claims) => {
    // Create or find the account. Key it on claims.iss + claims.sub, never the email.
  },
});
```

**Next.js:**

```ts
// app/api/auth/pidgeon/[action]/route.ts
import { routeHandlers } from '@pidgeon-ai/sign-in/next';
import { pidgeon } from '@/lib/pidgeon';

export const { GET, POST } = routeHandlers(pidgeon);
```

```tsx
// a page
import { headers } from 'next/headers';
import { buttonProps, sessionFrom } from '@pidgeon-ai/sign-in/next';

const session = await sessionFrom(pidgeon, await headers());
// …
<a {...buttonProps(pidgeon)} />;
```

**Express:**

```js
import { pidgeonMiddleware, requireSession } from '@pidgeon-ai/sign-in/express';

app.use(pidgeonMiddleware(pidgeon)); // before body parsers
app.get('/account', requireSession(), (req, res) => res.json(req.pidgeon.claims));
```

| Route                            | Who      | What                                                   |
| -------------------------------- | -------- | ------------------------------------------------------ |
| `GET /api/auth/pidgeon/login`    | a person | The button: off to Pidgeon, with PKCE                  |
| `GET /api/auth/pidgeon/callback` | a person | Back from Pidgeon; sets the session cookie             |
| `GET /api/auth/pidgeon/token`    | an agent | Your issuer and `client_id`, so an agent knows the way |
| `POST /api/auth/pidgeon/token`   | an agent | Signs the agent in; answers a bearer session           |

## What you learn

An agent:

```json
{
  "sub": "8f0c…",
  "kind": "agent",
  "email": "support-agent@acme.com",
  "operator": { "domain": "acme.com", "verified": true, "shared": false },
  "standing": "established",
  "card": "https://pidgeon.ai/api/v1/cards/8f0c…",
  "grant": {
    "scope": { "name": "bookings.change", "label": "manage bookings" },
    "grantor": { "type": "person", "email": "maria@example.com" },
    "subject": { "type": "customer", "id": "42" },
    "exp": 1767225600
  }
}
```

`actsFor(claims)` says who it acts for: the grant's grantor, else what its
card says. `operator.shared` is true on a domain anyone can get an address
on, and then `verified` is false.

A person: `kind: "person"`, their verified email, and the grants they gave
their agents **for your site** (never for anywhere else).

## How an agent signs in

With no browser and no person present, in two standard steps:

1. At Pidgeon, an RFC 8693 token exchange signed with the agent's own key
   (HTTP Message Signatures, Web Bot Auth's profile): its card, your
   `client_id`, and its grant. Pidgeon checks the card, the key and the grant,
   and issues an ID token for your site that names the agent's key (`cnf`).
2. At your site, that ID token as an RFC 7523 JWT-bearer grant, signed with
   the same key. This package checks the signature against the key in the
   token, so a copied token is useless, and accepts each token once.

An agent built on [`@pidgeon-ai/id`](https://www.npmjs.com/package/@pidgeon-ai/id)
does both in one call:

```ts
import { loadIdentity, signInWithPidgeon } from '@pidgeon-ai/id';

const identity = await loadIdentity('acme.com');
const { site } = await signInWithPidgeon(identity, {
  agent: 'support-agent@acme.com',
  site: 'https://shop.example/api/auth/pidgeon/token',
  grant, // the grant's JWS, when it acts under one
});
// site.access_token is your session for the agent.
```

An agent whose address is in a Pidgeon account has no signing key of its
own, so it signs in with an API key that can send as the address. The key
goes only to Pidgeon, never to an issuer a site names:

```ts
import { signInWithApiKey } from '@pidgeon-ai/id';

const { site } = await signInWithApiKey({
  agent: 'billing-agent@acme.com',
  apiKey: process.env.PIDGEON_API_KEY!,
  site: 'https://shop.example/api/auth/pidgeon/token',
});
```

For an API rather than a site, the agent asks for a token that says whom it
acts for (`delegation: true`, with a grant). It is a JWT per RFC 8693: `sub`
the person or organisation that granted, `act` the agent. Check it against
Pidgeon's JWKS, and ask `introspection_endpoint` (RFC 7662) whether it still
holds: one agent's tokens can be revoked without touching the grant.

Or from a terminal: `pidgeon id sign-in https://shop.example/api/auth/pidgeon/token --as support-agent`.

## Several servers

Used ID tokens are remembered in memory. Behind more than one server, pass a
shared `replay` store: `{ use(jti, expiresAt) }` answering `false` for a
`jti` it has seen.

Apache-2.0.
