# @pidgeon-ai/cli

`pidgeon`: email inboxes for AI agents, from a terminal. Give an agent its own
address on @pidgeon.email or your domain, send from it and wait for the reply.
https://pidgeon.ai

```sh
npm install -g @pidgeon-ai/cli
pidgeon login
pidgeon inboxes create bookings        # bookings@pidgeon.email
pidgeon send <inbox-id> --to ana@example.com --subject "Table for two" --text "Friday at 8?"
pidgeon mail wait <inbox-id>           # until the reply arrives
pidgeon send <inbox-id> --to ana@example.com --subject "Re: Table for two" --text "Booked." --reply-to <message-id>
```

More mail:

```sh
pidgeon inboxes create support --domain example.com   # your own domain, with mail on
pidgeon drafts create <inbox-id> --to ana@example.com --subject "…" --text "…"
pidgeon drafts approval <draft-id>    # a person sends or rejects it
pidgeon mail read <message-id>        # as the Firewall cleaned it
pidgeon threads hand-over <thread-id> # to a person
pidgeon app-passwords create <inbox-id> "Apple Mail"
pidgeon events
pidgeon api GET /v1/email/rules       # any /v1 call
```

## For platforms

Give every user of your platform inboxes of their own, white-labelled on their
domain: a pod for each.

```sh
pidgeon pods create "Acme Ltd"
pidgeon inboxes create support --domain acme.com --pod <pod-id>
```

## Sign in with Pidgeon

An agent signs in to websites as itself, with a key of its own.

```sh
pidgeon agents create "Booking agent" --purpose "Books tables."
pidgeon sites create Shop --redirect https://shop.example/callback
```

`agents create` registers the agent, makes its Ed25519 key on this machine,
publishes the public half in a request signed with the key, and keeps the
private half in `~/.config/pidgeon/agents/<id>.json`, readable by you only.
Your agent signs with it: `agentFromKeyFile(path)` from `@pidgeon-ai/sdk/node`,
or `PIDGEON_AGENT_KEY` (the file's `private_jwk`) and `PIDGEON_DIRECTORY`.
`pidgeon inboxes create bookings --agent <agent-id>` makes an inbox that
agent's.

## Everything else

`pidgeon --help` lists every command; `--json` prints the API's own answer.
A list prints a page at a time (`--limit`); when there is more, its last line
is the `--cursor` that reads the next page.

Signing in opens the browser once; the session is kept in
`~/.config/pidgeon/credentials.json` and refreshed. On a machine with no
browser, set `PIDGEON_API_KEY` instead. `PIDGEON_CONFIG_DIR` and
`PIDGEON_BASE_URL` move the files and the server.

Version 2 is for the new Pidgeon; 1.x spoke the old API at `/api/v1`.

## License

Apache-2.0
