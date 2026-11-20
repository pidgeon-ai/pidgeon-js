# Changelog

## 2.5.1

- `pidgeon --help` leads with Email, then pods and the account, agents and Sign
  in with Pidgeon. `pidgeon verify` and `pidgeon reports` still work and are no
  longer listed. The README and description lead with inboxes.

## 2.5.0

- `pidgeon sites update <client-id> [--name] [--redirect <uri>...]` and
  `pidgeon sites rotate-secret <client-id>`.

## 2.4.0

- `pidgeon agents rename <id> <name>`, `pidgeon agents revoke <id>`,
  `pidgeon keys revoke <agent-id> <kid>` and `pidgeon pods list|create|remove`.
- Lists that page (`agents`, `inboxes`, `mail list`, `search`, `threads
list`, `events`) take `--limit` and `--cursor`, and end with
  `More: --cursor <next>` when there is more; they were cut off silently.
- `mail list` shows sent mail by who it went to, not the inbox's address.
- `agents create` and `inboxes create` take `--pod`.
- `keys proof` takes `--name`, so the key file names its agent.
- Signed requests carry a nonce and cover the query (SDK 2.4.0).

## 2.3.0

- `pidgeon webhooks create --inbox <id>...` takes several inboxes.
- `--days` must be a whole number of days; `abc` used to ask for 30.
- The help lists `--cc` and `--bcc`, and that `drafts create` takes the
  same options as `send`.

## 2.2.0

- `pidgeon webhooks create --inbox <id>`: the endpoint hears only that
  inbox's events; `webhooks list` shows an endpoint's inboxes.

## 2.1.0

- Email: `pidgeon mail list|read|wait`, `pidgeon search`, `pidgeon threads
list|show|file|hand-over`, `pidgeon app-passwords`, and `--domain` on
  `inboxes create`.
- Bouncer: `pidgeon verify` and `pidgeon reports create`.
- Auth: `pidgeon sites` and `pidgeon mandates`.
- `pidgeon webhooks list|create|remove`.

## 2.0.0

The command line for the new Pidgeon. A new major version: 1.x spoke the old
email API at `/api/v1`, which is retired seven days after the switch.

- `pidgeon login`: sign in with the browser through Pidgeon's OAuth server,
  choosing what this machine may do; the session is refreshed from then on.
  `PIDGEON_API_KEY` still wins over it.
- `pidgeon agents create`: register an agent, make its key on this machine,
  publish it signed with itself, keep it in a file only you can read.
  `agents list`, `agents show` (keys and reputation), `keys create`, `keys list`.
- Email: `inboxes`, `send`, `drafts` (create, show, send, approval, remove).
- `events`, and `pidgeon api <method> <path>` for any `/v1` call. `--json` everywhere.
