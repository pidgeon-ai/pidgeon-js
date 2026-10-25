# Pidgeon for JavaScript and TypeScript

**Email inboxes for AI agents.** Pidgeon is the email inbox API for AI agents. It gives agents their own inboxes
so they can work with emails just like a human.

[pidgeon.ai](https://pidgeon.ai) · [Documentation](https://pidgeon.ai/docs)

```sh
npm install @pidgeon-ai/sdk
```

Create an address, send from it, wait for the answer, and reply in the thread:

```ts
import {
  client,
  identitiesCreate,
  messagesAwait,
  messagesReply,
  messagesSend,
} from '@pidgeon-ai/sdk';

client.setConfig({ auth: () => process.env.PIDGEON_API_KEY! });

// 1. An address of its own. Any free name on pidgeon.email works with no DNS.
const { data: address } = await identitiesCreate({
  body: { address: 'scout@pidgeon.email', type: 'agent' },
  throwOnError: true,
});

// 2. Send from it.
await messagesSend({
  body: {
    from: address.data.email,
    to: 'ops@example.com',
    subject: 'Staging access',
    text: 'Could you send me the access code?',
  },
  throwOnError: true,
});

// 3. Receive: one held-open request until the answer arrives, up to 60 seconds.
const { data: awaited } = await messagesAwait({
  query: { identity_id: address.data.id, timeout: 60 },
  throwOnError: true,
});

// 4. Reply into the same conversation. Recipients and subject come off the original.
if (awaited.data.message) {
  console.log(awaited.data.message.extracted.codes);
  await messagesReply({
    path: { id: awaited.data.message.id },
    body: { text: 'Thanks, that worked.' },
    throwOnError: true,
  });
}
```

`PIDGEON_API_KEY` is a `pgn_live_…` key. Make one at
[pidgeon.ai/app/developers/keys](https://pidgeon.ai/signup?utm_source=github&utm_medium=readme&utm_campaign=pidgeon-js&next=/app/developers/keys), or let
your agent sign itself up: [pidgeon.ai/skill.md](https://pidgeon.ai/skill.md).

## The packages

| Package | Install | What it is |
| --- | --- | --- |
| [`@pidgeon-ai/sdk`](packages/sdk) | `npm install @pidgeon-ai/sdk` | The TypeScript client, one function per operation |
| [`@pidgeon-ai/cli`](packages/cli) | `npm install -g @pidgeon-ai/cli` | Every endpoint as a command |
| [`@pidgeon-ai/mcp`](packages/mcp) | `npx -y @pidgeon-ai/mcp init` | The MCP server, run on your machine |
| [`@pidgeon-ai/ai-sdk`](packages/ai-sdk) | `npm install @pidgeon-ai/ai-sdk ai zod` | The same tools, for the Vercel AI SDK |
| [`@pidgeon-ai/openclaw`](packages/openclaw) | `openclaw plugins install @pidgeon-ai/openclaw` | Email as an OpenClaw channel: mail starts a conversation, the reply goes in the thread |

[`examples/openai-agents`](examples/openai-agents) is an OpenAI Agents SDK
agent on the hosted server, and [`examples/claude-agent-sdk`](examples/claude-agent-sdk)
a Claude Agent SDK one. Neither needs a package of ours.

**An MCP client needs no package at all.** Point it at
`https://pidgeon.ai/api/mcp` and it signs you in with OAuth:

```sh
claude mcp add --transport http pidgeon https://pidgeon.ai/api/mcp
```

The plugin for Claude Code, Codex, Cursor and Gemini CLI is
[pidgeon-ai/pidgeon-plugins](https://github.com/pidgeon-ai/pidgeon-plugins).

## Contributing

The SDK and the CLI are generated from [`openapi.json`](openapi.json), which
is the contract the API validates against and is published at
<https://pidgeon.ai/openapi.json>. The application that serves it is closed
source; these clients are not, and this is where they are readable. This
repository is copied from that one on every release.

**So a pull request against generated code cannot be merged as written** — the
fix belongs in the schema it came from. Open an issue instead and say what is
wrong; that is the faster route either way, because a wrong field here is a
wrong field in the published contract and in the Python client too.

Issues and questions: [open one](https://github.com/pidgeon-ai/pidgeon-js/issues),
or email [support@pidgeon.ai](mailto:support@pidgeon.ai).

MIT licensed.
