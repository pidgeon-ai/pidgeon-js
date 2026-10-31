import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';

import { type CallContext, dispatch, PidgeonHttpError } from './call.js';
import { pendingApprovalNote, REPLAY_NOTE } from './idempotency.js';
import { TOOLS } from './tools.js';

/**
 * Pidgeon, as a Model Context Protocol server.
 *
 * A **protocol adapter over an API already at parity**, and nothing else. No
 * business logic, no database, no LLM, no state of its own. Every tool is an
 * endpoint — `call.ts` dispatches on the endpoint the tool declares rather
 * than on its name, so there is nowhere to put behaviour the API does not
 * have. `tests/unit/mcp-adapter.test.ts` holds the other half: every declared
 * endpoint exists in `public/openapi.json`.
 *
 * `architecture.md` §7 listed MCP as deliberately absent, beside "no LLM, no
 * RAG, no agent runtime". That entry was written when this product was email
 * hosting; what it sells now is a programmable mailbox, and the person who
 * wants one is building an agent. The premise changed rather than the
 * judgement — an agent runtime is still not being built, and the constraints
 * above are what keep this from becoming one. `decisions.md` §154.
 *
 * ## Authorization is the key, and only the key
 *
 * The credential comes from `PIDGEON_API_KEY` and every call carries it.
 * Nothing here decides what may be reached: the key's own ceiling and the
 * addresses it was granted do all of it, server-side, exactly as they do for
 * any other caller.
 *
 * That matters more here than anywhere else, because this is the single most
 * likely place for a broad credential to be handed to a model. A key created
 * with `access: 'read'` can be given to an agent that must never send, and
 * `decisions.md` §143 is why that holds however generously the key is
 * granted. The README says so in the first paragraph.
 */

const DEFAULT_BASE_URL = 'https://pidgeon.ai/api/v1';

/**
 * What the server tells a client it is.
 *
 * **It said `0.1.0` while the package said `0.2.0`** — a hand-written literal
 * beside a published number, drifting quietly, which a customer spotted on 13
 * October by comparing the hosted server's `initialize` with npm. Nothing
 * breaks when these disagree, which is exactly why nobody notices: the only
 * person who can tell is somebody holding both.
 *
 * Still a literal, because reading `package.json` from a bundle that runs in
 * three places — npm, a stdio binary, and the hosted route — is a build
 * problem for no gain. `package-manifests.test.ts` pins it instead, the same
 * way it pins the clients to the contract.
 */
export const VERSION = '0.22.0';

export function createServer(context: CallContext): McpServer {
  const server = new McpServer({ name: 'pidgeon', version: VERSION });

  /*
   * Read per call, because the host names itself in `initialize`, which
   * arrives after this function returns. Reduced to a short run of plain
   * characters: it is a name a client chose and it goes into a header.
   */
  const calling: CallContext = {
    ...context,
    userAgent: () => {
      const host = server.server
        .getClientVersion()
        ?.name?.replace(/[^\w .-]/g, '')
        .trim()
        .slice(0, 40);
      return `@pidgeon-ai/mcp/${VERSION}${host ? ` (${host})` : ''}`;
    },
  };

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        // An object schema: v2 takes the raw shape only as a deprecated form.
        inputSchema: z.object(tool.inputSchema),
        /* Per tool, in `tools.ts` — and so the same on npm and at `/api/mcp`. */
        annotations: tool.annotations,
      },
      async (input: Record<string, unknown>) => {
        try {
          const { data, replayed } = await dispatch(tool, input, calling);
          const held = pendingApprovalNote(data);

          return {
            content: [
              /*
               * First, because a model that meant to send twice reads the
               * answer as "sent" unless something says otherwise.
               */
              ...(replayed ? [{ type: 'text' as const, text: REPLAY_NOTE }] : []),
              ...(held ? [{ type: 'text' as const, text: held }] : []),
              { type: 'text' as const, text: JSON.stringify(data, null, 2) },
            ],
          };
        } catch (error) {
          /*
           * Reported as a tool error rather than thrown, which is what lets a
           * model read the reason and act on it — "that address can only
           * reply to people who have written to it" is a sentence it can do
           * something about, where a transport-level failure is not.
           */
          const message =
            error instanceof PidgeonHttpError
              ? `${error.code}: ${error.message}`
              : error instanceof Error
                ? error.message
                : 'The request failed.';

          return { isError: true, content: [{ type: 'text' as const, text: message }] };
        }
      },
    );
  }

  return server;
}

export async function main(): Promise<void> {
  const apiKey = process.env.PIDGEON_API_KEY;
  const baseUrl = process.env.PIDGEON_BASE_URL ?? DEFAULT_BASE_URL;

  /*
   * `init` is a person at a terminal, not a client at a pipe.
   *
   * It is the only path in this package that may write to stdout — everywhere
   * else stdout is the protocol channel and a sentence there is a parse error
   * at the other end. Checked before the key, so a missing key gets the
   * installer's explanation rather than the server's one-line refusal.
   */
  if (process.argv[2] === 'init') {
    // Imported here, so the hosted server never loads the config editors.
    const { init } = await import('./init.js');
    const { CLIENTS } = await import('./clients.js');

    const flag = (name: string) => {
      const at = process.argv.findIndex((arg) => arg === name || arg.startsWith(`${name}=`));
      if (at === -1) return undefined;
      const arg = process.argv[at]!;
      return arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : process.argv[at + 1];
    };

    const client = flag('--client');
    const scope = flag('--scope');

    if (client !== undefined && !(CLIENTS as readonly string[]).includes(client)) {
      process.stdout.write(
        `--client takes ${CLIENTS.join(', ')}. Any other client: run init without it and move .mcp.json.\n`,
      );
      process.exit(1);
    }
    if (scope !== undefined && scope !== 'user' && scope !== 'project') {
      process.stdout.write('--scope takes user or project.\n');
      process.exit(1);
    }

    const result = await init({
      apiKey,
      baseUrl,
      cwd: process.cwd(),
      write: !process.argv.includes('--print'),
      force: process.argv.includes('--force'),
      fetch: globalThis.fetch,
      out: (line) => process.stdout.write(`${line}\n`),
      client: client as (typeof CLIENTS)[number] | undefined,
      scope,
      signIn: process.argv.includes('--sign-in'),
    });

    process.exit(result.ok ? 0 : 1);
  }

  if (!apiKey) {
    /*
     * To stderr and a non-zero exit. stdout is the protocol channel on a
     * stdio server, so a message written there is a parse error at the other
     * end rather than something a person reads.
     */
    process.stderr.write(
      'PIDGEON_API_KEY is not set. Create a key at https://pidgeon.ai/app/developers/keys — ' +
        'and give it the narrowest access the agent needs, because this hands it to a model.\n',
    );
    process.exit(1);
  }

  const server = createServer({ baseUrl, apiKey });

  await server.connect(new StdioServerTransport());
}

export { TOOLS } from './tools.js';
export type { ToolDefinition } from './tools.js';

/*
 * **Nothing runs on import.** `cli.ts` is the binary; this file is a
 * library.
 *
 * It used to end with `if (process.env.PIDGEON_MCP_NO_MAIN !== '1')
 * void main()` — a guard the tests set so that importing `createServer`
 * did not open a transport on stdio. That worked for the tests and was a
 * trap for everybody else: the hosted server imports this package, and
 * importing it ran `main()`, which found no `PIDGEON_API_KEY` and called
 * `process.exit(1)`. **The whole web server died on boot**, with the MCP
 * server's own error message as the only clue. §345.
 *
 * An environment variable cannot fix that, because the problem is not
 * which value it has — it is that a library had a side effect at all.
 */
