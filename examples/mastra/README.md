# Pidgeon with Mastra

A Mastra agent that gets an inbox of its own, sends itself a sign-in code and
waits for it to arrive, connected to the hosted MCP server at
`https://pidgeon.ai/api/mcp`. There is no Pidgeon package to install: Mastra's
`MCPClient` takes the server as it is.

`PIDGEON_API_KEY` is an admin key. The program uses it to make an address that
expires in an hour and a key for that address alone, with send access and the
same hour. The agent gets only that key. Create the admin key at
[pidgeon.ai/app/developers/keys](https://pidgeon.ai/app/developers/keys).

```sh
npm install
PIDGEON_API_KEY=pgn_live_… OPENAI_API_KEY=sk-… npx tsx main.ts
```

It uses `MODEL` when set (any model id Mastra's router knows, such as
`anthropic/claude-opus-5-5`), and `openai/gpt-5-mini` otherwise.

The guide is at [pidgeon.ai/docs/mastra](https://pidgeon.ai/docs/mastra).

MIT licensed.
