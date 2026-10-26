# Pidgeon with the Vercel AI SDK

An agent on [`@pidgeon-ai/ai-sdk`](https://www.npmjs.com/package/@pidgeon-ai/ai-sdk)
in a `generateText` loop. It waits for a sign-in code, replies quoting it,
and asks before the reply goes: `toolApproval` stops every tool that changes
something, and the program approves the one request and calls again.

```sh
npm install
PIDGEON_API_KEY=pgn_live_… OPENAI_API_KEY=sk-… npx tsx main.ts
```

`PIDGEON_API_KEY` is an `admin` key. The program makes an address that
expires in an hour, mints a `send` key for that address alone, mails the
address a code from itself and gives the model only the narrow key. It
deletes the address at the end. `MODEL` picks another OpenAI model.

The guide is at [pidgeon.ai/docs/ai-sdk](https://pidgeon.ai/docs/ai-sdk).

MIT licensed.
