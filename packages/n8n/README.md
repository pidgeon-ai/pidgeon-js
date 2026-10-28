# Pidgeon for n8n

**Email inboxes for AI agents, in n8n.** Give a workflow its own address. Mail
that arrives starts the workflow, and the workflow replies, saves drafts for a
person to send, hands threads to people and waits for verification codes.

[Pidgeon](https://pidgeon.ai/?utm_source=n8n) · [Setup and templates](https://pidgeon.ai/docs/n8n?utm_source=n8n)

The package has two nodes:

- **Pidgeon Trigger** starts a workflow when mail arrives at an address, or
  when a thread is handed to a person or back to the agent. It makes its own
  webhook on Pidgeon when the workflow starts listening and removes it when
  the workflow stops, and it checks every delivery's signature.
- **Pidgeon** acts on mail: create and list addresses, get, search, send and
  reply to messages, wait for a verification code, save and send drafts, hand
  a thread to a person or take it back, and download attachments.

## Install

n8n has verified the node.

- **n8n Cloud:** search for Pidgeon in the nodes panel of the canvas and add
  it. An owner or admin may need to allow verified community nodes first.
- **Self-hosted:** as an owner or admin, **Settings → Community Nodes →
  Install**, then enter:

```text
@pidgeon-ai/n8n-nodes-pidgeon
```

n8n reviews each new version before Cloud offers it, so Cloud can be a release
behind npm for a short while.

## The credential

Make a key at [pidgeon.ai/app/developers/keys](https://pidgeon.ai/app/developers/keys?utm_source=n8n),
then in n8n: **Credentials → New → Pidgeon API** and paste it.

**One address and one key per workflow, with the least access it needs**:
`read` for a trigger, `draft` to save drafts, `send` to reply or send.
Whatever the key reaches, the workflow can reach.

A **test key** (`pgn_test_…`) works the same way, and nothing it sends leaves
Pidgeon. Build the workflow on one, and make a live key when it works.

## The trigger's item

With _Fetch the message_ on (the default), every field a router branches on
is a plain field, so IF and Switch nodes test it with no model in between:

```json
{
  "event": "message.received",
  "message_id": "3c1e…",
  "thread_id": "9b27…",
  "address": "quotes@acme.pidgeon.email",
  "from": "priya@supplier.de",
  "from_name": "Priya Raman",
  "to": ["quotes@acme.pidgeon.email"],
  "cc": [],
  "subject": "Angebot 4471",
  "spam": false,
  "from_self": false,
  "bcc_to_this_address": false,
  "is_reply": false,
  "firewall_verdict": "clean",
  "auth_dmarc": "pass",
  "thread_owner_type": "agent",
  "text": "Guten Tag, anbei unser Angebot …",
  "codes": [],
  "links": [],
  "attachments": [
    { "id": "…", "filename": "angebot.pdf", "content_type": "application/pdf", "size": 48211 }
  ]
}
```

`text` is the clean text by default: Pidgeon Firewall takes out anything
hidden or addressed to an AI. `firewall_verdict` is `suspicious` when it found
something; route that mail to a person rather than to a model.

## Templates

Three workflows, as JSON to import, are at
[pidgeon.ai/docs/n8n](https://pidgeon.ai/docs/n8n?utm_source=n8n#templates):

- **Forward it to your agent.** Forward an email to the agent's address; a
  draft answer comes back to you as a reply.
- **The inbound qualifier.** Mail to a public address is sorted, drafted and
  handed to a person where it needs one.
- **An address per workflow.** A supplier's emailed CSV becomes rows in a
  sheet.

## Help

[Open an issue](https://github.com/pidgeon-ai/pidgeon-js/issues), or email
[support@pidgeon.ai](mailto:support@pidgeon.ai).

MIT licensed.
