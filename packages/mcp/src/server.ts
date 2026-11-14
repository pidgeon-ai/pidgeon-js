/**
 * Pidgeon's MCP server (MCP 1.0), run on the developer's machine over stdio.
 *
 * It runs here, not on pidgeon.ai, for one reason: an agent's key must be
 * made where the agent runs and never leave it. `set_up_agent` registers the
 * agent, makes its Ed25519 key on this machine, publishes the public half in
 * a request signed with the key (the possession proof the dashboard sends),
 * and writes the private half to a file only this user can read. No tool
 * ever answers a private key, so it never reaches the model either.
 *
 * Signing in is Pidgeon's OAuth server, as MCP authorization describes it:
 * `sign_in` opens the browser once, the person chooses what this machine may
 * do, and the session is refreshed from then on. `PIDGEON_API_KEY` wins
 * over a session, for machines with no browser.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import {
  addAgentKey,
  baseUrlOf,
  clientFromEnvironment,
  listAgentKeys,
  readSession,
  setUpAgent,
  signIn,
  signOut,
} from '@pidgeon-ai/sdk/node';

import { DESTROY, READ, registerApiTools, run, VERSION, WRITE } from './tools.ts';

export { VERSION };

const SIGN_IN_HINT = 'Call sign_in, which opens the browser for the person to approve.';
const answer = (work: () => Promise<unknown>) => run(work, SIGN_IN_HINT);

export type Options = {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  /** Whether `sign_in` opens the browser itself (it always shows the address too). */
  openBrowser?: boolean;
  /** For tests: what a person does in the browser when signing in. */
  onSignInUrl?: (url: string) => void;
};

const INSTRUCTIONS = `Pidgeon gives AI agents an identity apart from their owner: Passport (an agent's signing key and its operator's reputation), Bouncer (websites verify agents), Email (inboxes for agents) and Auth (Sign in with Pidgeon).

To set an agent up: sign_in if a tool says you are not signed in, then set_up_agent with a name and what it does. That registers it, makes its key on this machine, publishes the public half and keeps the private key in a file here; it is never shown to you. Then create_inbox with agent_id to give it an address, and get_reputation to see how websites will treat it.

Sending mail: send_message sends now; create_draft then request_approval when a person should look first. A message answered "held" waits for a person of the account.`;

export function createServer(options: Options = {}): McpServer {
  const env = options.env ?? process.env;
  const baseUrl = baseUrlOf(env);
  const pidgeon = clientFromEnvironment({ env, baseUrl, fetch: options.fetch });
  const server = new McpServer(
    { name: 'pidgeon', title: 'Pidgeon', version: VERSION },
    { instructions: INSTRUCTIONS },
  );

  // ------------------------------------------------------------ signing in

  server.registerTool(
    'sign_in',
    {
      title: 'Sign in to Pidgeon',
      description:
        'Open the browser so the person signs in to Pidgeon and approves this machine. Waits until they answer (up to five minutes). `scope` is the most it asks for: admin sets agents and inboxes up, send sends mail, draft only drafts, read only reads.',
      inputSchema: { scope: z.enum(['admin', 'send', 'draft', 'read']).default('admin') },
      annotations: WRITE,
    },
    ({ scope }) =>
      answer(async () => {
        if (env.PIDGEON_API_KEY)
          return {
            signed_in: true,
            with: 'PIDGEON_API_KEY',
            note: 'An API key is set; it is used instead of a session.',
          };
        let shown = '';
        const session = await signIn({
          baseUrl,
          scope,
          env,
          fetch: options.fetch,
          clientName: 'Pidgeon MCP',
          openBrowser: options.openBrowser ?? true,
          onUrl: (url) => {
            shown = url;
            process.stderr.write(`Sign in to Pidgeon: ${url}\n`);
            options.onSignInUrl?.(url);
          },
        });
        return { signed_in: true, base_url: baseUrl, scope: session.scope, url_opened: shown };
      }),
  );

  server.registerTool(
    'sign_out',
    {
      title: 'Sign out of Pidgeon',
      description: 'End this machine’s session with Pidgeon and forget its tokens.',
      annotations: DESTROY,
    },
    () =>
      answer(async () => ({ signed_out: await signOut(baseUrl, { env, fetch: options.fetch }) })),
  );

  server.registerTool(
    'status',
    {
      title: 'Signed in?',
      description:
        'Whether this machine is signed in to Pidgeon, how, and the agent keys it keeps.',
      annotations: READ,
    },
    () =>
      answer(async () => {
        const session = await readSession(baseUrl, env);
        return {
          base_url: baseUrl,
          signed_in: Boolean(env.PIDGEON_API_KEY || session),
          with: env.PIDGEON_API_KEY
            ? 'PIDGEON_API_KEY'
            : session
              ? `a session (${session.scope})`
              : null,
          agent_keys_here: await listAgentKeys(env),
        };
      }),
  );

  // -------------------------------------------------------------- Passport

  server.registerTool(
    'set_up_agent',
    {
      title: 'Set an agent up',
      description:
        'Register an agent, make its signing key on this machine, publish the public half (signed with the key, which proves it is held), and keep the private key in a file only this user can read. Answers the agent, its key id, its directory and the key file — never the key. The agent signs its requests with that file: `agentFromKeyFile(path)` in @pidgeon-ai/sdk/node, or PIDGEON_AGENT_KEY (the file’s private_jwk) and PIDGEON_DIRECTORY anywhere else.',
      inputSchema: {
        name: z.string().min(1).max(80).describe('What websites see the agent called.'),
        purpose: z.string().max(280).optional().describe('What it does, in a sentence.'),
        pod_id: z.string().uuid().optional(),
      },
      annotations: WRITE,
    },
    ({ name, purpose, pod_id }) =>
      answer(async () => {
        const made = await setUpAgent(pidgeon, { name, purpose, podId: pod_id }, env);
        return {
          agent: made.agent,
          kid: made.kid,
          key_file: made.keyFile,
          directory: made.agent.directory,
          next: 'create_inbox with agent_id gives it an address; get_reputation shows how websites see it.',
        };
      }),
  );

  server.registerTool(
    'create_agent_key',
    {
      title: 'Make a new key for an agent',
      description:
        'Make a new key on this machine for an agent already registered, publish it signed with itself, and keep it here, replacing the key file this machine had for the agent. The old key stays valid until it is revoked in the dashboard.',
      inputSchema: { agent_id: z.string().uuid() },
      annotations: WRITE,
    },
    ({ agent_id }) => answer(() => addAgentKey(pidgeon, agent_id, env)),
  );

  registerApiTools(server, pidgeon, SIGN_IN_HINT);

  return server;
}
