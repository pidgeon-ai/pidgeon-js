# Changelog

## 1.0.0

The MCP server for the new Pidgeon, run on your machine over stdio.

- Sets an agent up end to end: `sign_in` (Pidgeon's OAuth server, once, in
  the browser), `set_up_agent` (registered, its key made here and published
  signed with itself, the private key kept in a file and never shown to the
  model), `create_agent_key`, `get_agent`, `get_reputation`, `list_agents`.
- Email: `list_inboxes`, `get_inbox`, `create_inbox`, `remove_inbox`,
  `send_message`, `create_draft`, `get_draft`, `update_draft`, `delete_draft`,
  `send_draft`, `request_approval`, `list_rules`, `add_rule`, `remove_rule`,
  `list_suppressions`.
- `status`, `sign_out`, `list_events`.
