# Changelog

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
