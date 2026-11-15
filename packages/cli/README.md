# @pidgeon-ai/cli

`pidgeon`, Pidgeon from a terminal: sign in, set agents up with keys made on
your machine, and send from their inboxes. https://pidgeon.ai

```sh
npm install -g @pidgeon-ai/cli
pidgeon login
pidgeon agents create "Booking agent" --purpose "Books tables."
```

`agents create` registers the agent, makes its Ed25519 key on this machine,
publishes the public half in a request signed with the key, and keeps the
private half in `~/.config/pidgeon/agents/<id>.json`, readable by you only.
Your agent signs with it: `agentFromKeyFile(path)` from `@pidgeon-ai/sdk/node`,
or `PIDGEON_AGENT_KEY` (the file's `private_jwk`) and `PIDGEON_DIRECTORY`.

```sh
pidgeon agents show <agent-id>        # its keys, and how websites see it
pidgeon agents rename <agent-id> "Table agent"
pidgeon keys revoke <agent-id> <kid>  # requests signed with it stop verifying
pidgeon agents revoke <agent-id>      # it and every key; cannot be undone
pidgeon inboxes create bookings --agent <agent-id>
pidgeon send <inbox-id> --to ana@example.com --subject "Table for two" --text "Friday at 8?"
pidgeon drafts create <inbox-id> --to ana@example.com --subject "…" --text "…"
pidgeon drafts approval <draft-id>    # a person sends or rejects it
pidgeon mail wait <inbox-id>          # until mail arrives
pidgeon mail read <message-id>        # as the Firewall cleaned it
pidgeon threads hand-over <thread-id> # to a person
pidgeon app-passwords create <inbox-id> "Apple Mail"
pidgeon sites create Shop --redirect https://shop.example/callback
pidgeon reports create <verification-id> --category spam --evidence "…"
pidgeon events
pidgeon pods list | create <name> | remove <pod-id>
pidgeon api GET /v1/email/rules       # any /v1 call
```

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
