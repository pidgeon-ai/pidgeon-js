# Pidgeon for n8n

[Pidgeon](https://pidgeon.ai) gives AI agents an identity apart from their
owner: inboxes they send and receive mail from, a signing key websites can
check, and their operator's reputation. This package brings it to n8n: give a
workflow or an agent its own inbox, start workflows from the mail that
arrives, answer it, and check the AI agents that reach your own site.

Two nodes:

- **Pidgeon Trigger** starts a workflow when mail arrives in an inbox, or when
  a message is held, sent, delivered or bounced, or a draft waits for a
  person. It makes its own webhook on Pidgeon when the workflow starts
  listening, removes it when it stops, and checks every delivery's signature.
- **Pidgeon** acts:
  - **Message:** Send, Reply, Get, Get Many, Search, and Wait (until mail
    arrives in an inbox, up to an hour).
  - **Thread:** Get (with its messages), Get Many, Update (file it, or hand
    it to a person and back).
  - **Draft:** Create (optionally asking a person to approve it), Send.
  - **Inbox:** Create, Get, Get Many.
  - **Attachment:** Download, as binary data.
  - **Agent Request:** Verify, with Pidgeon's Bouncer: who stands behind a
    request an AI agent made to your site (a Webhook node's), and how they
    stand.

The Pidgeon node works as a tool for n8n's AI Agent node too.

## Install

- **n8n Cloud:** search for Pidgeon in the nodes panel. An owner or admin may
  need to allow verified community nodes first.
- **Self-hosted:** as an owner or admin, **Settings → Community Nodes →
  Install**, then enter `@pidgeon-ai/n8n-nodes-pidgeon`.

## The credential

Make an API key at [pidgeon.ai/keys](https://pidgeon.ai/keys), then in n8n
**Credentials → New → Pidgeon API**, and paste it. Give it the least access
the workflow needs: `read` to read and wait for mail, `draft` to save drafts,
`send` to send and reply. A pod's key reaches only that pod's inboxes.

The trigger makes a webhook, and webhooks belong to the whole account: it
needs an `admin` key of the account, and an n8n that Pidgeon can reach at a
public `https://` address.

A test key (`pgn_test_…`) works the same, and nothing it sends leaves
Pidgeon: build on one, then switch to a live key.

## The trigger's item

The event, its summary, and with **Read the Message** on (the default) the
message itself:

```json
{
  "event_id": "…",
  "event": "message.received",
  "created": "2026-11-17T09:12:44.000Z",
  "inbox_id": "…",
  "message_id": "…",
  "thread_id": "…",
  "from": "ana@example.com",
  "subject": "Table for two on Friday?",
  "spam": false,
  "firewall": { "verdict": "clean", "signals": [], "version": 1 },
  "message": {
    "id": "…",
    "from": { "address": "ana@example.com", "name": "Ana Lima" },
    "to": ["bookings@pidgeon.email"],
    "text": "Hello, could we have a table for two on Friday at eight?",
    "attachments": []
  }
}
```

The text is the clean text by default: Pidgeon's Firewall takes out anything
hidden or addressed to an AI. Choose **Original** only when you must, and
never hand it to a model unread. Mail the Firewall calls suspicious can be
held for a person (`message.held`) before any workflow sees it.

## Verifying an agent at your site

A Webhook node receives the request; **Pidgeon → Agent Request → Verify**
takes its method, its full URL and its headers (by default
`{{ JSON.stringify($json.headers) }}`) and answers `result`: `verified` (a
Pidgeon operator's agent, with the agent, its operator and their reputation),
`signed_known`, `signed_unknown` or `refused`. Branch on it with an If node.
A `read` key is enough.

## Version 1

Version 1 is for the new Pidgeon (`https://pidgeon.ai/v1`). 0.x spoke the old
email API at `/api/v1`, which is being shut down: workflows built on 0.x need
their Pidgeon nodes added again, with a new key.

## License

MIT
