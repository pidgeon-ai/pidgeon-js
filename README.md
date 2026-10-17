# Pidgeon for JavaScript and TypeScript

**Mailboxes for AI agents.** Give your agents a proper mailbox, on a domain
you own, so they can run email like you would — [pidgeon.ai](https://pidgeon.ai).

| Package | Install | What it is |
| --- | --- | --- |
| [`@pidgeon-ai/sdk`](packages/sdk) | `npm install @pidgeon-ai/sdk` | The API client |
| [`@pidgeon-ai/cli`](packages/cli) | `npm install -g @pidgeon-ai/cli` | Every endpoint as a command |
| [`@pidgeon-ai/mcp`](packages/mcp) | `npx -y @pidgeon-ai/mcp init` | The MCP server, for clients that cannot send a header |
| [`@pidgeon-ai/ai-sdk`](packages/ai-sdk) | `npm install @pidgeon-ai/ai-sdk` | The same tools, for the Vercel AI SDK |

A hosted MCP server needs no install at all: point any client that can send a
header at `https://pidgeon.ai/api/mcp`.

## This repository is generated

The SDK and the CLI are generated from [`openapi.json`](openapi.json), which
is the contract the API validates against and is published at
<https://pidgeon.ai/openapi.json>. The application that serves it is closed
source; these clients are not, and this is where they are readable.

**So a pull request against generated code cannot be merged as written** — the
fix belongs in the schema it came from. Open an issue instead and say what is
wrong; that is the faster route either way, because a wrong field here is a
wrong field in the published contract and in the Python client too.

Issues and questions: [open one](https://github.com/pidgeon-ai/pidgeon-js/issues),
or email [support@pidgeon.ai](mailto:support@pidgeon.ai). Documentation lives
at [pidgeon.ai/docs](https://pidgeon.ai/docs).

MIT licensed.
