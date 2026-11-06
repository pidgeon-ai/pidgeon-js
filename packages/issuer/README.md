# @pidgeon-ai/issuer

A Post issuer you run yourself, inside your own network. Your own domain
signs your AI agents' cards, sign-ins and grants, with a key that never
leaves you, for the agents your identity provider says you have. Nothing is
sent to Pidgeon: not the key, not the list of agents.

It is for companies that may not hand authentication to a third party. Pidgeon
Cloud runs the same issuer for everyone else. Both speak the same protocol, so
`@pidgeon-ai/id` (the agent's side) and `@pidgeon-ai/sign-in` (the site's)
work with either one unchanged.

```bash
npx @pidgeon-ai/issuer keygen acme.com
```

## What runs where

| Where                  | What                                                                       |
| ---------------------- | -------------------------------------------------------------------------- |
| Inside your network    | The issuer (`pidgeon-issuer serve`, or the container), its key, its config |
| Your identity provider | Who the agents are: their addresses, keys and groups                       |
| `post.<your domain>`   | The public documents: your keys, your agents' cards, OpenID discovery      |
| `_post.<your domain>`  | A TXT record, so verifiers find `post.<your domain>`                       |
| Each agent             | Its own Ed25519 key, which signs its mail, its requests and its sign-ins   |

The token endpoint only needs to reach your agents. Everything a stranger
reads is a document: publish it through your reverse proxy, or write it out
with `pidgeon-issuer export <dir>` and serve it from any static host.

## Run it

1. **The issuer's key**, once: `pidgeon-issuer keygen acme.com`. It writes
   `pidgeon-issuer-key.json` (mode 0600). Mount it as a secret, or put the
   seed in `PIDGEON_ISSUER_KEY`. Any `Signer` fits in its place, so a KMS or
   an HSM needs no change to the rest.
2. **Each agent's key**, on the agent's machine: `pidgeon-issuer keygen
acme.com --out ~/.config/pidgeon/id/acme.com.json`. Give the identity
   provider the `key` line it prints; the private half stays with the agent.
3. **`issuer.json`**: copy `issuer.example.json`. `directory.static` lists
   agents by hand. `grants` maps a group to what its agents may do, signed by
   your domain as the organisation. `clients` are the sites you let your
   agents sign in to.
4. **DNS**: `pidgeon-issuer dns` prints the `_post` record and where
   `post.acme.com` must answer.
5. **Serve**: `pidgeon-issuer serve` (port `PORT`, default 8080), or
   `docker build -f packages/issuer/Dockerfile -t pidgeon-issuer .` from this
   repository's root and run it with the config and the key mounted at
   `/etc/pidgeon-issuer/`.

## Sign in to a site

A site lists your issuer beside Pidgeon's:

```ts
import { pidgeonSignIn } from '@pidgeon-ai/sign-in';

export const pidgeon = pidgeonSignIn({
  clientId: 'client_shop',
  url: 'https://shop.example',
  secret: process.env.PIDGEON_SESSION_SECRET!,
  issuers: ['https://post.acme.com'],
});
```

and your agent signs in as it would through Pidgeon Cloud: its card comes from
`post.acme.com`, and it goes to the issuer that signed the card.

```ts
import { loadIdentity, signInWithPidgeon } from '@pidgeon-ai/id';

const { site } = await signInWithPidgeon(await loadIdentity('acme.com'), {
  agent: 'support-agent@acme.com',
  site: 'https://shop.example/api/auth/pidgeon/token',
});
```

## What it checks before it signs anything

- The token request is signed by a key your identity provider gives an
  agent, covers what it must, and is used once (one replica, or pass a
  shared `replay` store).
- The card is one this issuer signed, current, that agent's, naming that key.
- The agent is live in the identity provider **now**: disable it there and
  its next sign-in fails.
- A grant is one this issuer signed, that agent's, still held through its
  group, and for that site.

## Left out

The person's sign-in, userinfo, introspection and revocation endpoints (an ID
token lasts five minutes; revoking an agent is disabling it), dynamic client
registration, and Pidgeon's card log, which would mean sending us your agents.
Authorization stays yours: a grant is a relation (`customer:42#refunds.issue`
for an agent), so it can be written from the engine you already run.

Apache-2.0.
