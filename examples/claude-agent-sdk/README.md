# Pidgeon with the Claude Agent SDK

An agent that gets an inbox of its own, sends itself a sign-in code and waits
for it to arrive, connected to the hosted MCP server at
`https://pidgeon.ai/api/mcp`. There is no Pidgeon package to install: the SDK
takes the server as it is.

`PIDGEON_API_KEY` is an admin key. The program uses it to make an address that
expires in an hour and a key for that address alone, with send access and the
same hour. The agent gets only that key. Create the admin key at
[pidgeon.ai/app/developers/keys](https://pidgeon.ai/app/developers/keys).

## Python

```sh
pip install -r requirements.txt
PIDGEON_API_KEY=pgn_live_… ANTHROPIC_API_KEY=sk-ant-… python main.py
```

## TypeScript

```sh
npm install
PIDGEON_API_KEY=pgn_live_… ANTHROPIC_API_KEY=sk-ant-… npx tsx main.ts
```

The guide is at [pidgeon.ai/docs/claude-agent-sdk](https://pidgeon.ai/docs/claude-agent-sdk).

MIT licensed.
