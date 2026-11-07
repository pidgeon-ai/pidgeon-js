# @pidgeon-ai/issuer

A Post issuer you run yourself, inside your own network. Your own domain
signs your AI agents' cards, sign-ins and grants, with a key that never
leaves you, for the agents your identity provider (Keycloak, Auth0, Okta) says you have. Nothing is
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
   seed in `PIDGEON_ISSUER_KEY`. Or keep it in AWS KMS, below. Any `Signer`
   fits in its place, so an HSM needs no change to the rest.
2. **Each agent's key**, on the agent's machine: `pidgeon-issuer keygen
acme.com --out ~/.config/pidgeon/id/acme.com.json`. Give the identity
   provider the `key` line it prints; the private half stays with the agent.
3. **`issuer.json`**: copy `issuer.example.json`. `directory.keycloak` reads
   the agents from Keycloak (below); `directory.static` lists them by hand. `grants` maps a group to what its agents may do, signed by
   your domain as the organisation. `clients` are the sites you let your
   agents sign in to.
4. **DNS**: `pidgeon-issuer dns` prints the `_post` record and where
   `post.acme.com` must answer.
5. **Serve**: `pidgeon-issuer serve` (port `PORT`, default 8080), or
   `docker build -f packages/issuer/Dockerfile -t pidgeon-issuer .` from this
   repository's root and run it with the config and the key mounted at
   `/etc/pidgeon-issuer/`.

## Keycloak

An agent is a Keycloak client with a service account, in the `agents` group.
Its key is the Ed25519 key Keycloak authenticates it with (Credentials →
Signed JWT, EdDSA), so the agent holds one key for Keycloak and for sites; a
client on a secret names its key in a `pidgeon.key` attribute instead.
`pidgeon.address` (default `<clientId>@<domain>`) and `pidgeon.kind` say the
rest, and its groups are what `grants` maps.

```json
"directory": {
  "keycloak": {
    "url": "https://sso.acme.internal",
    "realm": "acme",
    "client_id": "pidgeon-issuer",
    "group": "agents"
  }
}
```

`pidgeon-issuer` is a client of its own with a service account holding
`realm-management`'s `view-clients` and `view-users`, nothing that writes; its
secret is `KEYCLOAK_CLIENT_SECRET`. `examples/self-hosted-issuer` runs all of
it in Docker.

## Auth0

An agent is a machine-to-machine application whose metadata names it:
`pidgeon_key` (the agent's public key), `pidgeon_address`, and optionally
`pidgeon_kind`, `pidgeon_groups` (comma-separated) and `pidgeon_disabled`
(`true` to switch it off; Auth0 applications have no enabled switch). The
issuer reads them with an application of its own authorized for the
Management API with `read:clients` only; its secret is
`AUTH0_CLIENT_SECRET`.

```json
"directory": { "auth0": { "tenant": "acme.eu.auth0.com", "client_id": "<the issuer's app>" } }
```

## Okta

An agent is an active OAuth service app whose profile names it:
`"profile": { "pidgeon": { "key": "…", "address": "…", "kind": "agent",
"groups": ["refunds"] } }`. Deactivate the app to switch it off. The issuer
reads them with a service app of its own granted `okta.apps.read` and a
read-only admin role, signing in with Private Key JWT; its RSA or P-256
private key is `OKTA_PRIVATE_KEY`.

```json
"directory": { "okta": { "org": "https://acme.okta.com", "client_id": "<the issuer's app>" } }
```

On Auth0 and Okta the agent authenticates to the provider with its own RSA
or EC credential: neither accepts an Ed25519 key for that, so the one-key
trick is Keycloak's alone.

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

## The key in AWS KMS

Make an Ed25519 key that never leaves KMS and name it instead of a file:

```bash
aws kms create-key --key-spec ECC_NIST_EDWARDS25519 --key-usage SIGN_VERIFY
aws kms create-alias --alias-name alias/pidgeon-issuer --target-key-id <key id>
```

```json
"key": { "kms": "alias/pidgeon-issuer", "region": "eu-west-1" }
```

The issuer's role needs `kms:GetPublicKey` and `kms:Sign` on that key and
nothing else; credentials come the AWS SDK's usual way. Install
`@aws-sdk/client-kms` beside the library (the container image has it). The
key is read once at start: an alias is pinned to the key it names then, and
every signature is checked against that key before it leaves.

## A person signs in, through your identity provider

Your staff sign in to the same sites as themselves, through your own OpenID
Connect provider (Keycloak, Auth0, Okta, Entra), with the flow Pidgeon Cloud
uses. Register the issuer at the provider as a confidential client whose
redirect URI is `https://post.acme.com/api/post/oidc/callback`, then:

```json
"person": {
  "oidc": { "issuer": "https://sso.acme.com/realms/acme", "client_id": "pidgeon-issuer" }
},
"clients": [
  {
    "client_id": "client_shop",
    "host": "shop.example",
    "redirect_uris": ["https://shop.example/api/auth/pidgeon/callback"]
  }
]
```

with the client's secret in `PIDGEON_PERSON_CLIENT_SECRET` and a random
`PIDGEON_ISSUER_SECRET` of 32 characters or more (`openssl rand -base64 32`),
which seals the sign-in in progress and the sixty-second code, so there is
still no database. The issuer will not start without it. Rotating it only
ends the sign-ins in flight.

A site that sets `issuer: 'https://post.acme.com'` signs people in there.
The person must have a verified address at your domain that is not an
agent's; the site gets `kind: "person"`, your provider's `sub` and that
address.

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

Userinfo, introspection and revocation endpoints (an ID
token lasts five minutes; revoking an agent is disabling it), dynamic client
registration, and Pidgeon's card log, which would mean sending us your agents.
Authorization stays yours: a grant is a relation (`customer:42#refunds.issue`
for an agent), so it can be written from the engine you already run.

Apache-2.0.
