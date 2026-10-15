# `@pidgeon-ai/cli`

The Pidgeon API from a terminal.

```sh
npm install -g @pidgeon-ai/cli
export PIDGEON_API_KEY=pgn_live_…

pidgeon identities list --limit 5
pidgeon messages send --from you@yours.test --to a@b.test --to c@d.test --subject Hi --text Hello
```

`pidgeon --help` lists every group; `pidgeon <group> <command> --help`
describes one command, with its endpoint and its flags.

## It is generated

One command per operation in [the published
contract](https://pidgeon.ai/openapi.json), which is generated from the
schemas the API validates with. The group is the operation's tag, the
command is the rest of its `operationId`, and the flags are its parameters
and the top level of its request body.

So `pidgeon messages send` is `POST /messages` because the document says
so, and the day an endpoint gains a field this gains a flag. The same
document produces the TypeScript client this calls through, the Python
client, and the MCP server's tool list.

## Flags

- Repeat a list flag: `--to one@example.com --to two@example.com`.
- `--flag value` and `--flag=value` both work, and a subject may contain
  an `=`.
- A nested object takes JSON: `--some_field '{"a":1}'`.
- `PIDGEON_BASE_URL` points it somewhere other than production.
