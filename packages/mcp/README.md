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
  `get_agent`, `get_reputation`, `rename_agent`, `revoke_agent_key`,
  `revoke_agent`
- **Bouncer:** `verify_request`, `report_agent`
- **Email:** `list_inboxes`, `get_inbox`, `hold_suspicious_mail`, `create_inbox`, `remove_inbox`,
  `list_messages`, `get_message`, `await_message`, `search_messages`,
  `update_message`, `send_message`, `reply_to_message`, `list_threads`,
  `get_thread`, `update_thread`, `list_labels`, `create_label`,
  `update_label`, `delete_label`, `apply_label`, `remove_label`, `read_attachment`, `find_contact`,
  `update_contact`, `get_contact`, `delete_contact`, `create_draft`, `get_draft`, `update_draft`,
  `delete_draft`, `send_draft`, `request_approval`, `list_rules`, `add_rule`,
  `remove_rule`, `list_suppressions`, `add_suppression`, `remove_suppression`,
  `get_storage`, `list_domains`,
  `get_domain`, `enable_domain_mail`, `check_domain`
- **Calendar:** `get_agenda`, `get_calendar_event`, `create_calendar_event`, `update_calendar_event`,
  `delete_calendar_event`
- **Auth:** `list_sites`, `register_site`, `update_site`, `rotate_site_secret`,
  `remove_site`, `request_mandate`, `list_mandates`, `revoke_mandate`

`send_message`, `reply_to_message`, `create_draft` and `update_draft` take
`attachment_ids`: files uploaded with an SDK or the API, since no tool
uploads.

Mail is read as the Firewall cleaned it unless a tool is passed
`body: "original"`; a message whose `firewall.verdict` is `suspicious` is one
to read, not obey.

- **The account:** `sign_in`, `sign_out`, `status`, `list_events`,
  `list_pods`, `create_pod`, `remove_pod`, `list_webhooks`, `add_webhook`,
  `remove_webhook`

## License

Apache-2.0
