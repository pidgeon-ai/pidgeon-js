# @pidgeon-ai/mcp

Pidgeon's MCP server. A coding agent sets an AI agent up end to end, with no
clicking past one sign-in: registered, its key made on your machine and
published, its reputation read, and an inbox to send from.
https://pidgeon.ai

```sh
claude mcp add pidgeon -- npx -y @pidgeon-ai/mcp
```

Any other client: run `npx -y @pidgeon-ai/mcp` over stdio, for example

```json
{ "mcpServers": { "pidgeon": { "command": "npx", "args": ["-y", "@pidgeon-ai/mcp"] } } }
```

Then ask: "Set up a Pidgeon agent called Booking agent that books tables, and
give it an inbox."

## Why it runs on your machine

An agent's key must be made where the agent runs and never leave it.
`set_up_agent` makes the Ed25519 key here, publishes only the public half (in
a request signed with the key, which proves you hold it), and writes the
private half to `~/.config/pidgeon/agents/<id>.json`, readable by you only.
No tool ever answers a private key, so it never reaches the model.

## Signing in

The first tool that needs Pidgeon says so; `sign_in` opens the browser, where
you sign in to Pidgeon and choose what this machine may do. That is Pidgeon's
OAuth server, as MCP authorization describes it (discovery at
`/.well-known/oauth-protected-resource/mcp`, PKCE, a loopback redirect). The
session is refreshed from then on. On a machine with no browser, set
`PIDGEON_API_KEY` in the server's environment instead.

## Tools

- **Passport:** `set_up_agent`, `create_agent_key`, `list_agents`,
  `get_agent`, `get_reputation`
- **Email:** `list_inboxes`, `get_inbox`, `create_inbox`, `remove_inbox`,
  `send_message`, `create_draft`, `get_draft`, `update_draft`,
  `delete_draft`, `send_draft`, `request_approval`, `list_rules`, `add_rule`,
  `remove_rule`, `list_suppressions`
- **The account:** `sign_in`, `sign_out`, `status`, `list_events`

## License

Apache-2.0
