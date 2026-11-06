# A self-hosted issuer, with Keycloak

Acme runs its own Pidgeon issuer. Keycloak, its identity provider, says who
its agents are; the issuer signs for `acme.test` with a key that never leaves
this machine; and an agent signs in to a website with no person present. Then
an administrator disables the agent in Keycloak, and its next sign-in fails.
Nothing here reaches Pidgeon.

```bash
pnpm demo
docker compose down   # afterwards
```

Needs Docker and Node 22. The first run builds the issuer's image from this
repository (`packages/issuer/Dockerfile`).

## What runs

| Where            | What                                                                |
| ---------------- | ------------------------------------------------------------------- |
| `localhost:8081` | Keycloak, realm `acme` (`keycloak/realm-acme.json`; admin / admin)  |
| `localhost:8080` | The issuer for `acme.test` (`issuer/issuer.json`)                   |
| `localhost:3490` | Shoebox, a site that lists Acme's issuer (`site.ts`)                |
| `.keys/`         | The issuer's key and the agent's, made by the demo, never committed |

## How Keycloak becomes Pidgeon IDs

An agent is a Keycloak client with a service account, in the `agents` group.
Its key is the one Keycloak authenticates it with (below), which the demo sets
as an administrator would in the console; its attributes `pidgeon.address`
and `pidgeon.kind` say the rest. Its groups map to grants in `issuer.json`: `refunds` lets it
issue refunds for Acme, signed by `acme.test` as the organisation.

The issuer reads Keycloak with a client of its own (`pidgeon-issuer`) that can
view clients and users and nothing else. It asks again for the one agent on
every sign-in, so disabling the client, removing it from `agents`, switching
off its service account or replacing its key ends its next sign-in.

## One key, for Keycloak and for sites

The agent's client authenticates to Keycloak with a signed JWT under the
agent's own Ed25519 key (Credentials → Signed JWT, algorithm EdDSA; the key in
its JWKS). The issuer reads the same key from there, so the one key the agent
holds signs it in to Keycloak and to every site, and no secret exists. Step 3
of the demo gets a Keycloak token with it. A client that authenticates with a
secret instead names its key in a `pidgeon.key` attribute.
