# @pidgeon-ai/ai-sdk

Pidgeon as [Vercel AI SDK](https://ai-sdk.dev) tools: a real mailbox your
agent can create addresses in, send from, read, and wait on.

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
    identityId: process.env.PIDGEON_IDENTITY_ID,
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

| Tool                 | What it does                                                 |
| -------------------- | ------------------------------------------------------------ |
| `list_addresses`     | The addresses the key can reach                              |
| `create_address`     | A new address, optionally `reply_only` and with an end date  |
| `get_address`        | One address, its capabilities and its send policy            |
| `list_threads`       | Conversations in one address                                 |
| `get_thread`         | One conversation, by the `thread_id` a webhook gave you      |
| `list_messages`      | The messages of a conversation                               |
| `search_messages`    | Full-text across every address the key reaches               |
| `get_message`        | One message with its body and what was extracted from it     |
| `await_message`      | Wait for the next message, codes and links already extracted |
| `send_message`       | Send, subject to the address's send policy                   |
| `reply_to_message`   | Answer one; recipients and subject come off the original     |
| `update_thread`      | Hand a conversation to a person, or take it back             |
| `update_message`     | Star, or move to archive, spam or trash                      |
| `list_send_rules`    | Why a send was refused                                       |
| `list_receive_rules` | Why mail did not arrive                                      |
| `list_folders`       | The folders of one mailbox, with counts                      |
| `list_folder`        | What is in one folder, with a `sync_cursor`                  |
| `list_changes`       | What moved since a `sync_cursor`                             |
| `list_events`        | The log of what happened                                     |
| `list_labels`        | The labels on one address                                    |
| `create_label`       | A new label on one address                                   |
| `apply_label`        | Put a label on a conversation                                |
| `remove_label`       | Take one off                                                 |
| `list_pods`          | The pods in the account                                      |
| `create_pod`         | A pod for one of your customers                              |
| `get_metrics`        | Sent, delivered, bounced and the rest, over a window         |

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

Documentation: [pidgeon.ai/docs](https://pidgeon.ai/docs).
