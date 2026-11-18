# Changelog

## 1.9.0

- `list_api_keys`, `create_api_key` and `revoke_api_key`: an agent with an admin
  key of the whole account makes and revokes keys, never stronger than its own.
- The registry's description names the four products: "The trust layer for AI
  agents: Passport, Bouncer, Email and Auth, from one MCP server."

## 1.8.0

- `verify_request` describes the four results Pidgeon answers: `verified`,
  `signed_known`, `signed_unknown` and `refused`.

## 1.7.0

- The registry entry names the hosted server again: `https://pidgeon.ai/mcp`
  (Streamable HTTP, sign-in by OAuth), beside the npm package.
- `update_site` and `rotate_site_secret`.

## 1.6.0

- `send_message`, `reply_to_message`, `create_draft` and `update_draft` take
  `attachment_ids`: files uploaded with an SDK or the API.
- `rename_agent`, `revoke_agent_key`, `revoke_agent` and `remove_pod`.
- `add_webhook` offers the mandate events.
- `status` names a key made by `pidgeon keys proof` after its agent, not
  its id, when signed in.

## 1.5.0

- `hold_suspicious_mail`: hold mail the Firewall calls suspicious for a
  person. `enable_domain_mail`: turn mail on for a proved domain.
- `create_inbox` takes `domain`; `search_messages` takes `body` and serves
  the cleaned text by default, as the other mail tools do.
- `update_calendar_event` takes `all_day` and `null` to clear `description`
  or `location`; `create_calendar_event` needs no `end` for an all-day one.
- `send_draft` takes a `send_at` with an offset; `request_mandate` keeps to
  the API's limits; `add_webhook` offers the events webhooks carry;
  `list_threads`'s `starred` is only `true`; `update_contact` clears with
  `null`; `update_draft` no longer takes `reply_to`.
- Descriptions say what the API does: reports, the event log, the access
  rules and mandates take.

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
