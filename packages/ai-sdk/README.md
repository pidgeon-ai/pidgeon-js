# @pidgeon-ai/ai-sdk

Email inboxes for AI agents, as [Vercel AI SDK](https://ai-sdk.dev) tools.
Give each agent its own address on @pidgeon.email or your domain: the model
sends, waits for the reply and answers in the thread, with your API key.
https://pidgeon.ai

```sh
npm install @pidgeon-ai/ai-sdk ai
```

## An agent with an inbox

```ts
import { generateText, isStepCount } from 'ai';
import { pidgeonToolApproval, pidgeonTools } from '@pidgeon-ai/ai-sdk';

const tools = pidgeonTools(); // PIDGEON_API_KEY

const { text } = await generateText({
  model: 'anthropic/claude-sonnet-5.5',
  tools,
  // Removing an inbox, revoking an agent and the like wait for a person.
  toolApproval: pidgeonToolApproval(tools),
  stopWhen: isStepCount(10),
  prompt:
    'Make an inbox called bookings, email ops@example.com from it to ask for the ' +
    'staging access code, wait for the answer and tell me the code.',
});
```

The model calls `create_inbox`, `send_message`, then `await_message`, which
holds the request open until mail arrives. A message answered `held` waits for
a person of the account before it goes.

## What the tools cover

- **Email:** inboxes, sending, replying, drafts and approval, waiting for
  mail, search, conversations, labels, contacts, attachments, rules,
  suppressions, domains, and each inbox's calendar.
- **Pods and the account:** a pod for each user of your platform, with
  inboxes of their own; API keys, webhooks and the event log.
- **Agents:** the account's agents, their keys and their reputation.
  Registering an agent makes a key, which belongs where the agent runs: use
  `@pidgeon-ai/sdk` (`pidgeon.agents.setUp`) or the MCP server's
  `set_up_agent` for that.
- **Sign in with Pidgeon:** sites and mandates.

They are the tools of Pidgeon's hosted MCP server (`https://pidgeon.ai/mcp`),
with the same names, descriptions and inputs: this package builds them from
that server's list in [`@pidgeon-ai/mcp`](https://www.npmjs.com/package/@pidgeon-ai/mcp),
so a tool added there is here on the next install. A key reaches what its
access and pod allow: give an agent a `send` or `draft` key, not `admin`.

## Options

```ts
pidgeonTools({
  apiKey: 'pgn_live_…', // PIDGEON_API_KEY when left out
  baseUrl: 'https://pidgeon.ai',
  client, // a Pidgeon from @pidgeon-ai/sdk, instead of the two above
  only: ['list_inboxes', 'send_message', 'await_message'], // a smaller set
});
```

Each tool's `metadata` says what it does to the account: `readOnly`,
`destructive`, and its `title`. `pidgeonToolApproval(tools)` asks a person
before every destructive one.

A refusal from the API (a key without the access, a missing inbox) is thrown
as the tool's error, in words the model can act on.

## Version 1

Version 1 is for the new Pidgeon. 0.x spoke the old email API at `/api/v1`,
which is being shut down; 0.16.0 is its last.
