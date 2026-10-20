# `@pidgeon-ai/cli`

Email inboxes for AI agents, from a terminal. Pidgeon is the email inbox API
for AI agents. It gives agents their own inboxes so they can work with emails
just like a human. This is every endpoint as a command, so an agent with a
shell, or you, can create an address, send, receive and reply.

```sh
npm install -g @pidgeon-ai/cli
```

Or run it without installing: `npx -y @pidgeon-ai/cli --help`.

## Get a key

Every command reads a `pgn_live_…` key from `PIDGEON_API_KEY`. Make one at
[pidgeon.ai/app/developers/keys](https://pidgeon.ai/app/developers/keys), or
let your agent sign itself up: [pidgeon.ai/skill.md](https://pidgeon.ai/skill.md)
is two calls, and the only thing it needs from a person is a six-digit code.

```sh
export PIDGEON_API_KEY=pgn_live_…
```

## Create an address, send, receive, reply

```sh
pidgeon identities create --address scout@pidgeon.email --type agent
pidgeon messages send --from scout@pidgeon.email --to ops@example.com \
  --subject "Staging access" --text "Could you send me the access code?"
pidgeon messages await --identity_id <id> --timeout 60
pidgeon messages reply --id <message id> --text "Thanks, that worked."
```

Any free name on `pidgeon.email` works with no DNS. `messages await` holds
one request open until mail arrives, and prints it with `extracted.codes` and
`extracted.links` already pulled out.

`pidgeon --help` lists every group; `pidgeon <group> <command> --help`
describes one command, with its endpoint and its flags. Documentation:
[pidgeon.ai/docs/cli](https://pidgeon.ai/docs/cli).

## Flags

- Repeat a list flag: `--to one@example.com --to two@example.com`.
- `--flag value` and `--flag=value` both work, and a subject may contain
  an `=`.
- A nested object takes JSON: `--some_field '{"a":1}'`.
- `PIDGEON_BASE_URL` points it somewhere other than production.

## When it fails

A refusal from the API exits 1 and prints the status, the API's code and
its sentence, as in `403 abuse_blocked: That message has already gone to a
lot of people today…`. Branch on the code. A mistake in the command itself,
such as a missing flag, exits 2. Before 1.8.4 a refusal also exited 2 and
printed only the sentence.

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

## Contributing

This package is published from
[pidgeon-ai/pidgeon-js](https://github.com/pidgeon-ai/pidgeon-js), which is
copied from Pidgeon's main repository on every release, so a pull request
there cannot be merged as written.
[Open an issue](https://github.com/pidgeon-ai/pidgeon-js/issues) and say what
is wrong, or email [support@pidgeon.ai](mailto:support@pidgeon.ai).

MIT licensed.
