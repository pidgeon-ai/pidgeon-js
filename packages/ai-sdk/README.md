# @pidgeon-ai/ai-sdk

Pidgeon as [Vercel AI SDK](https://ai-sdk.dev) tools: a real inbox your
agent can create addresses in, send from, read, and wait on. Pidgeon is the
email inbox API for AI agents. It gives agents their own inboxes so they can
work with emails just like a human.

```sh
npm install @pidgeon-ai/ai-sdk ai zod
```

## Sending, and waiting for the answer

```ts
import { generateText, isStepCount } from 'ai';
import { pidgeonTools } from '@pidgeon-ai/ai-sdk';

const { text } = await generateText({
  model: 'anthropic/claude-sonnet-5.5',
  tools: pidgeonTools({
    apiKey: process.env.PIDGEON_API_KEY,
    identityId: process.env.PIDGEON_ADDRESS_ID,
  }),
  stopWhen: isStepCount(10),
  prompt:
    'Email ops@yourdomain.com from agent@yourdomain.com and ask for the staging access code. ' +
    'Wait for the reply and tell me the code.',
});
```

The model calls `send_message`, then `await_message`, which holds one request
open until mail arrives and returns it with `extracted.codes` and
`extracted.links` already pulled out. There is no polling loop to write.

`identityId` is the address a tool uses when the model names none. Without it,
the model has to pass `identity_id` itself, and `list_addresses` is how it
finds one.

## Options

| Option       | Default                     | What it is                                        |
| ------------ | --------------------------- | ------------------------------------------------- |
| `apiKey`     | `PIDGEON_API_KEY`           | A Pidgeon API key. Required one way or the other. |
| `baseUrl`    | `https://pidgeon.ai/api/v1` | Where the API is.                                 |
| `identityId` | none                        | The address a tool uses when the model names none |
| `client`     | built from the above        | A client from `createClient` in `@pidgeon-ai/sdk` |

## Tools

The same tools as [`@pidgeon-ai/mcp`](https://www.npmjs.com/package/@pidgeon-ai/mcp),
with the same names and the same descriptions, because the descriptions are
read from that server's list rather than copied. Each one calls one operation
in [`@pidgeon-ai/sdk`](https://www.npmjs.com/package/@pidgeon-ai/sdk).

<!-- tools:start -->

| Tool                    | What it does                                                                                                                                                                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_setup`             | Call this first.                                                                                                                                                                                                                             |
| `list_addresses`        | The addresses this credential can reach.                                                                                                                                                                                                     |
| `create_address`        | Create an address for an agent to use.                                                                                                                                                                                                       |
| `get_address`           | One address, by id.                                                                                                                                                                                                                          |
| `list_threads`          | Conversations in one address, newest first.                                                                                                                                                                                                  |
| `get_thread`            | One conversation, by id.                                                                                                                                                                                                                     |
| `list_messages`         | The messages of one conversation, oldest first — the text to read before replying.                                                                                                                                                           |
| `search_messages`       | Full-text search across every address this credential can reach, ranked by relevance.                                                                                                                                                        |
| `send_message`          | Send from an address this credential may send as.                                                                                                                                                                                            |
| `check_message`         | Asks whether `send_message` with these arguments would go, and sends nothing.                                                                                                                                                                |
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

## Asking before anything is sent

Every tool carries `metadata.readOnly`, and `WRITE_TOOLS` names the ones that
change something. Pass them to `toolApproval` to have a person confirm each
send, reply or hand-over:

```ts
import { WRITE_TOOLS, pidgeonTools } from '@pidgeon-ai/ai-sdk';

generateText({
  model,
  tools: pidgeonTools(),
  toolApproval: Object.fromEntries(WRITE_TOOLS.map((name) => [name, 'user-approval'])),
  prompt,
});
```

## The key is the whole of the access control

This hands an API key to a model. Nothing in this package decides what may be
reached: the key's own ceiling and the addresses it was granted do all of it,
server-side, exactly as for any other caller. So give it the narrowest key the
agent needs. A key created with `read` access can never send.

A refusal reaches the model as a tool error carrying the API's own sentence —
_"That address can only reply to people who have written to it first"_ — so it
can tell a person why.

A `pgn_live_…` key comes from
[pidgeon.ai/app/developers/keys](https://pidgeon.ai/signup?utm_source=npm&utm_medium=readme&utm_campaign=ai-sdk&next=/app/developers/keys), or
an agent can sign itself up by reading
[pidgeon.ai/skill.md](https://pidgeon.ai/skill.md).

Documentation: [pidgeon.ai/docs/ai-sdk](https://pidgeon.ai/docs/ai-sdk).

## Contributing

This package is published from
[pidgeon-ai/pidgeon-js](https://github.com/pidgeon-ai/pidgeon-js), which is
copied from Pidgeon's main repository on every release, so a pull request
there cannot be merged as written.
[Open an issue](https://github.com/pidgeon-ai/pidgeon-js/issues) and say what
is wrong, or email [support@pidgeon.ai](mailto:support@pidgeon.ai).

MIT licensed.
