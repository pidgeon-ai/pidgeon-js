# @pidgeon-ai/mcp

An MCP server that gives your AI agent its own email inbox. Pidgeon is the
email inbox API for AI agents. It gives agents their own inboxes so they can
work with emails just like a human.

Over [Model Context Protocol](https://modelcontextprotocol.io) an agent can
create addresses, send, wait for a reply with its verification codes already
pulled out, answer in the thread, and hand a conversation to a person. There
are two ways in, and they are the same server.

## Hosted: a URL, and you sign in

```sh
claude mcp add --transport http pidgeon https://pidgeon.ai/api/mcp
```

The first call answers `401`, and the client sends you to Pidgeon to sign in
with OAuth. You choose what it can do — read, read and send, or full access —
and which addresses it can reach. Claude's custom connectors, ChatGPT, Cursor,
Codex and VS Code take the same URL and sign in the same way. Nothing to
install.

For an agent with nobody there to sign in, send a key instead:

```sh
claude mcp add --transport http pidgeon https://pidgeon.ai/api/mcp \
  --header "Authorization: Bearer $PIDGEON_API_KEY"
```

The Claude Code, Codex, Cursor and Gemini CLI plugin installs the hosted
server with a skill that teaches the agent to use it:
[pidgeon-ai/pidgeon-plugins](https://github.com/pidgeon-ai/pidgeon-plugins).

## Or installed: this package

For a client that runs MCP servers as local processes.

```sh
PIDGEON_API_KEY=pgn_live_… npx -y @pidgeon-ai/mcp init
```

That checks the key against the API and tells you which addresses it reaches
— the one question a block of JSON cannot answer, and the one that otherwise
surfaces as a model quietly getting an error you never see. Then it writes
`.mcp.json` in the current directory and prints what it wrote.

`--print` to see the config without writing it, which is what you want if your
client keeps its own somewhere else. `--force` to replace an entry that is
already there.

For Codex, VS Code and Gemini CLI, `--client` writes the hosted server into
that client's own file instead:

```sh
npx -y @pidgeon-ai/mcp init --client codex    # ~/.codex/config.toml
npx -y @pidgeon-ai/mcp init --client vscode   # .vscode/mcp.json
npx -y @pidgeon-ai/mcp init --client gemini   # .gemini/settings.json
```

With no `PIDGEON_API_KEY` it writes the URL alone and the client signs you in
(`codex mcp login pidgeon`, `/mcp auth pidgeon` in Gemini CLI, a browser
prompt in VS Code). With a key it checks the key first and has the client read
it from the variable, or ask for it once in VS Code, so it is never in the
file. It keeps everything already in the file, comments included, backs a
changed file up to `<file>.bak`, and is a no-op the second time. `--scope
user|project` picks the other file; `--sign-in` ignores a key that is set.

The key is referenced from the environment rather than written into the file,
so the config can be committed and the credential cannot:

```json
{
  "mcpServers": {
    "pidgeon": {
      "command": "npx",
      "args": ["-y", "@pidgeon-ai/mcp"],
      "env": { "PIDGEON_API_KEY": "${PIDGEON_API_KEY}" }
    }
  }
}
```

A `pgn_live_…` key comes from
[pidgeon.ai/app/developers/keys](https://pidgeon.ai/signup?utm_source=npm&utm_medium=readme&utm_campaign=mcp&next=/app/developers/keys). No
account yet? An agent can sign itself up by reading
[pidgeon.ai/skill.md](https://pidgeon.ai/skill.md); the only thing it needs
from a person is a six-digit code.

`PIDGEON_BASE_URL` points it somewhere else, which is how you run it against a
local checkout.

Documentation: [pidgeon.ai/docs/mcp](https://pidgeon.ai/docs/mcp).

## Tools

<!-- tools:start -->

| Tool                    | What it does                                                                                                                                                                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_addresses`        | The addresses this credential can reach.                                                                                                                                                                                                     |
| `create_address`        | Create an address for an agent to use.                                                                                                                                                                                                       |
| `get_address`           | One address, by id.                                                                                                                                                                                                                          |
| `list_threads`          | Conversations in one address, newest first.                                                                                                                                                                                                  |
| `get_thread`            | One conversation, by id.                                                                                                                                                                                                                     |
| `list_messages`         | The messages of one conversation, oldest first — the text to read before replying.                                                                                                                                                           |
| `search_messages`       | Full-text search across every address this credential can reach, ranked by relevance.                                                                                                                                                        |
| `send_message`          | Send from an address this credential may send as.                                                                                                                                                                                            |
| `get_message`           | One message, by id, with its body, the headers we keep, and what the sending domain’s records proved — `authentication.spf`, `.dkim`, `.dmarc`, where null means not reported rather than failed.                                            |
| `await_message`         | Waits until a message arrives at an address — after you submit a sign-up form, say — and returns it with `extracted.codes` and `extracted.links`: verification codes and confirm links, most likely first.                                   |
| `reply_to_message`      | The recipients, the subject and the thread are read off the message being answered, so you bring the words and nothing else.                                                                                                                 |
| `forward_message`       | Sends one message on to somebody it was not addressed to, with its attachments, from the address that received it.                                                                                                                           |
| `create_draft`          | Writes a message without sending it, for a human to read and send — use it when you are asked to prepare replies for sign-off.                                                                                                               |
| `get_draft_approval`    | Where a held send stands, by its `draft_id`: `pending` until a person approves or rejects it in the dashboard, then `approved` (it was sent, and `message_id` is the message), `rejected`, or `expired` after 24 hours with nobody deciding. |
| `list_drafts`           | Every draft at one address, newest first, with its recipients and body — so you can come back to one and finish it.                                                                                                                          |
| `get_draft`             | One draft by id: its sender, recipients, subject, text and attachments.                                                                                                                                                                      |
| `update_draft`          | Changes the fields you pass and leaves the rest; `null` clears the subject or text.                                                                                                                                                          |
| `delete_draft`          | Deletes one draft, and cancels its send if it was scheduled.                                                                                                                                                                                 |
| `read_attachment`       | The text of one attachment — a CSV, a log, JSON, a calendar file, or a PDF, a Word `.docx` or an Excel `.xlsx`.                                                                                                                              |
| `update_thread`         | Who owns a conversation and where it has got to.                                                                                                                                                                                             |
| `update_message`        | Star a message, or move it to `archive`, `spam` or `trash`.                                                                                                                                                                                  |
| `list_send_rules`       | The allow and block list of one address, and the send policy it hangs off.                                                                                                                                                                   |
| `list_receive_rules`    | The rules that decide what reaches one address — reject, spam, trash, archive or inbox, per sender or per domain — and its `receive_policy`.                                                                                                 |
| `list_folders`          | Every folder of one address with its counts.                                                                                                                                                                                                 |
| `list_folder`           | One folder of one address, newest first, a conversation per row — where `list_threads` says which conversations exist, this says where they are filed and what they look like in a list.                                                     |
| `list_changes`          | Everything that moved in one inbox since a `sync_cursor`, arrivals included, so a long-running agent does not re-read a folder to find one new message.                                                                                      |
| `list_events`           | Every event across every address this credential reaches — mail received, sent, delivered, bounced, filed.                                                                                                                                   |
| `list_labels`           | Labels belong to an address, not to the workspace, so the same name on three addresses is three labels with three ids.                                                                                                                       |
| `create_label`          | A label on one address.                                                                                                                                                                                                                      |
| `apply_label`           | The label has to belong to the same address the conversation is in — `list_labels` for that address gives you the right id.                                                                                                                  |
| `remove_label`          | Removes one label from one conversation.                                                                                                                                                                                                     |
| `list_pods`             | A pod is a container for one of your own customers: it holds addresses and domains, and **mail sent from it lands on its own sending reputation**, so one customer cannot damage another’s delivery.                                         |
| `create_pod`            | A container for one of your customers, with its own sending reputation.                                                                                                                                                                      |
| `get_metrics`           | Sent, delivered, bounced, rejected, complained, received and spam over a window of `days` — counted from the event log, so it includes outcomes the provider reported afterwards.                                                            |
| `get_calendar`          | The calendar of one address, by the address’s `id`: its default time zone and how many events it holds.                                                                                                                                      |
| `update_calendar`       | The time zone an event created without one gets, as an IANA name like `Europe/Lisbon`.                                                                                                                                                       |
| `get_agenda`            | What is on an address’s calendar between `after` and `before` (ISO 8601 date-times), in start order, with each date of a recurring event listed on its own.                                                                                  |
| `get_calendar_event`    | One event by `eventId` on the calendar of address `id`: its times, description, location, recurrence, and its attendees with their answers.                                                                                                  |
| `create_calendar_event` | Puts an event on the calendar of address `id`.                                                                                                                                                                                               |
| `update_calendar_event` | Changes one calendar event: the fields you pass, leaving the rest.                                                                                                                                                                           |
| `delete_calendar_event` | Removes an event from the calendar of address `id`.                                                                                                                                                                                          |
| `respond_to_invitation` | Answers a meeting invitation that arrived as mail, by the message’s `id`: `accepted`, `declined` or `tentative`, with an optional `comment`.                                                                                                 |

<!-- tools:end -->

## Handing a conversation to a person

`get_message`, `reply_to_message`, `update_message` and `update_thread` are
the loop: read a message, answer it, file it, and say who owns it.

```
update_thread  id=<thread_id>  owner_type=human
```

It appears in the web inbox and `thread.updated` tells whatever was driving
the conversation that it no longer is. `owner_type=agent` takes it back,
`status` is the queue it sits in, and `assignee_id` names which person has it.

## A retried send goes out once

`send_message` and `reply_to_message` take an `idempotency_key`. Reuse it
when retrying the same send and it goes out once; the retry answers with
the first send's result, after a line saying nothing was sent again. With
no key, an identical call (same arguments, same credential) within the same
clock hour counts as a retry. To send the same words twice on purpose
inside that hour, pass a new key.

## Two settings worth knowing about

An agent's address should usually be created **`reply_only`**: it can answer
anybody who has written to it and start a conversation with nobody, which is a
structural limit rather than a quantity. `create_address` takes it.

It can also be given an **end date**. An address per ticket or per invoice
stops accepting mail when the thing is over; expiry suspends the address and
keeps the correspondence.

## The credential is the whole of the access control

This hands a credential to a model. Nothing in this package decides what may
be reached — the key's own ceiling and the addresses it was granted do all of
it, server-side, exactly as for any other caller.

So **give it the narrowest key the agent needs**. A key created with `read`
access can never send, however generously it is granted an inbox, and an
agent that only has to triage should have one.

## What this is not

A protocol adapter over an API that already exists, and nothing else. No
business logic, no database, no model, no state.

Every tool **is** an endpoint: the dispatcher works off the endpoint each tool
declares rather than off its name, so there is nowhere to put behaviour the
API does not have, and a test asserts each one exists in the published
OpenAPI document. If something is missing here, it is missing from the API,
and that is where it gets built.

## Contributing

This package is published from
[pidgeon-ai/pidgeon-js](https://github.com/pidgeon-ai/pidgeon-js), which is
copied from Pidgeon's main repository on every release, so a pull request
there cannot be merged as written.
[Open an issue](https://github.com/pidgeon-ai/pidgeon-js/issues) and say what
is wrong, or email [support@pidgeon.ai](mailto:support@pidgeon.ai).

MIT licensed.
