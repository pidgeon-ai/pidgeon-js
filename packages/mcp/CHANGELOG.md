# Changelog

## 1.4.0

- `add_webhook` takes `inbox_ids`: the endpoint hears only those inboxes'
  events.

## 1.3.0

- Labels: `update_label` (rename or recolour), `delete_label`.
- Contacts: `get_contact`, `delete_contact`.
- The calendar: `get_calendar_event`.
- The do-not-send list: `add_suppression`, `remove_suppression`.
- Webhooks: `list_webhooks`, `add_webhook` (answers the secret once),
  `remove_webhook`.

## 1.2.0

- `get_storage`: how much of the account's 10 GB is used.
- Domains: `list_domains`, `get_domain` (its mail status and the records to
  set), `check_domain` (ask DNS now). A key of the whole account only.
- Pods: `list_pods`, `create_pod` (the Everything level, of the whole
  account); pass a pod's id as `pod_id` to `register_agent` or
  `register_site`.

## 1.1.1

- `create_calendar_event`, `update_calendar_event` and
  `delete_calendar_event` take `send_invites` (and the first two
  `attendees`): the attendees get an invitation, an update or a
  cancellation from the inbox.

## 1.1.0

- Reading mail, with the old server's names kept where the tool still
  exists: `list_messages`, `get_message` and `await_message` (cleaned by the
  Firewall unless `body: "original"`), `search_messages`, `update_message`,
  `reply_to_message`.
- Conversations: `list_threads`, `get_thread`, `update_thread` (file, star,
  hand to a person), `list_labels`, `create_label`, `apply_label`,
  `remove_label`; `read_attachment`; `find_contact`, `update_contact`.
- The calendar: `get_agenda`, `create_calendar_event`,
  `update_calendar_event`, `delete_calendar_event`.
- Bouncer: `verify_request`, `report_agent`. Auth: `list_sites`,
  `register_site`, `remove_site`, `request_mandate`, `list_mandates`,
  `revoke_mandate`.
- `create_inbox` takes `agent` or `events`, the kinds that exist.
- Not carried over: `forward_message`. Passing on text a key read to someone
  outside the conversation is what canary tokens refuse.

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
