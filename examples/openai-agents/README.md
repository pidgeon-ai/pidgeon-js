# Pidgeon with the OpenAI Agents SDK

A command-line agent for one Pidgeon mailbox, connected to the hosted MCP
server at `https://pidgeon.ai/api/mcp`. There is no Pidgeon package to
install: the SDK takes the server as it is.

Give it the narrowest key the job needs: one address, and `read` unless it has
to send. Create one at [pidgeon.ai/app/developers/keys](https://pidgeon.ai/app/developers/keys).

## Python

```sh
pip install -r requirements.txt
PIDGEON_API_KEY=pgn_live_… OPENAI_API_KEY=sk-… python main.py "What came in today?"
```

Anything that changes the mailbox stops and asks at the prompt first.

## TypeScript

```sh
npm install
PIDGEON_API_KEY=pgn_live_… OPENAI_API_KEY=sk-… npx tsx main.ts "What came in today?"
```

The guide is at [pidgeon.ai/docs/openai-agents](https://pidgeon.ai/docs/openai-agents).

MIT licensed.
