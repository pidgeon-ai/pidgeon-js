# @pidgeon-ai/mcp

Email inboxes for AI agents, as an MCP server. Give each agent its own address
on @pidgeon.email or your own domain: it sends, waits for the reply and answers
in the thread. https://pidgeon.ai

```sh
claude mcp add pidgeon -- npx -y @pidgeon-ai/mcp
```

Any other client: run `npx -y @pidgeon-ai/mcp` over stdio, for example

```json
{ "mcpServers": { "pidgeon": { "command": "npx", "args": ["-y", "@pidgeon-ai/mcp"] } } }
```

Then ask: "Give this agent an inbox called bookings, email ops@example.com
from it and wait for the reply."

The agent calls `create_inbox`, `send_message`, then `await_message`.

## For platforms

Give every user of your platform inboxes of their own, white-labelled on their
domain: one pod per user (`create_pod`), and `pod_id` on `create_inbox`. A key
of a pod reaches only that pod's mail.

## Sign in with Pidgeon

An agent can also sign in to websites as itself, with a key of its own.
`set_up_agent` registers it and makes that key on this machine.

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

- **Email:** `create_inbox`, `list_inboxes`, `get_inbox`, `hold_suspicious_mail`,
  `set_inbox_signature`, `set_inbox_agent`, `remove_inbox`, `send_message`, `create_draft`,
  `get_draft`, `update_draft`, `delete_draft`, `send_draft`, `request_approval`,
  `list_messages`, `get_message`, `await_message`, `search_messages`,
  `update_message`, `reply_to_message`, `list_threads`, `get_thread`,
  `update_thread`, `list_labels`, `create_label`, `update_label`,
  `delete_label`, `apply_label`, `remove_label`, `read_attachment`,
  `find_contact`, `update_contact`, `get_contact`, `delete_contact`,
  `list_rules`, `add_rule`, `remove_rule`, `list_suppressions`,
  `add_suppression`, `remove_suppression`, `get_storage`, `list_domains`,
  `get_domain`, `enable_domain_mail`, `check_domain`
- **Calendar:** `get_agenda`, `get_calendar_event`, `create_calendar_event`,
  `update_calendar_event`, `delete_calendar_event`
- **Pods and the account:** `sign_in`, `sign_out`, `status`, `list_pods`,
  `create_pod`, `rename_pod`, `move_to_pod`, `remove_pod`, `list_events`,
  `list_api_keys`, `create_api_key`, `revoke_api_key`, `list_webhooks`,
  `add_webhook`, `remove_webhook`
- **Agent identities:** `set_up_agent`, `create_agent_key`, `list_agents`, `get_agent`,
  `get_reputation`, `rename_agent`, `revoke_agent_key`, `revoke_agent`
- **Sign in with Pidgeon:** `list_sites`, `register_site`, `update_site`,
  `rotate_site_secret`, `remove_site`, `request_mandate`, `list_mandates`,
  `revoke_mandate`

`send_message`, `reply_to_message`, `create_draft` and `update_draft` take
`attachment_ids`: files uploaded with an SDK or the API, since no tool
uploads.

Mail is read as the Firewall cleaned it unless a tool is passed
`body: "original"`; a message whose `firewall.verdict` is `suspicious` is one
to read, not obey.

## License

Apache-2.0
