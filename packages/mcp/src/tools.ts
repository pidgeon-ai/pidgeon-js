/**
 * The MCP tools that only call Pidgeon's API, shared by the server on the
 * developer's machine (`server.ts`, stdio) and the hosted one at
 * `https://pidgeon.ai/mcp`: reading agents and reputation, Email's inboxes,
 * drafts and rules, and the event log. Nothing here touches the file system,
 * so the app can run it. Tools that make keys live where keys are made.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { PidgeonError, type Pidgeon } from '@pidgeon-ai/sdk';

export const VERSION = '1.0.0';

export const json = (value: unknown): CallToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value ?? { ok: true }, null, 2) }],
});

export const failed = (text: string): CallToolResult => ({
  isError: true,
  content: [{ type: 'text', text }],
});

/** Run a tool's work and answer its result, or the API's refusal in words the model can act on. */
export async function run(
  work: () => Promise<unknown>,
  signInHint = 'Sign in to Pidgeon again.',
): Promise<CallToolResult> {
  try {
    return json(await work());
  } catch (error) {
    if (error instanceof PidgeonError) {
      const hint =
        error.code === 'not_signed_in' || error.status === 401
          ? ` ${signInHint}`
          : error.status === 403 && error.code === 'forbidden'
            ? ' A key or sign-in with more access can.'
            : '';
      return failed(`${error.message} (${error.status} ${error.code}).${hint}`);
    }
    return failed(error instanceof Error ? error.message : String(error));
  }
}

const addresses = z.array(z.string().email()).min(1).max(50);
const messageShape = {
  to: addresses.describe('Who it is to.'),
  cc: z.array(z.string().email()).optional(),
  bcc: z.array(z.string().email()).optional(),
  subject: z.string().max(998),
  text: z.string().optional().describe('The plain-text body. Send text, html or both.'),
  html: z.string().optional(),
  reply_to: z
    .string()
    .uuid()
    .optional()
    .describe('A message of this inbox to reply to; the reply joins its thread.'),
};
type MessageArgs = {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text?: string;
  html?: string;
  reply_to?: string;
};
const asMessage = (args: MessageArgs) => ({
  to: args.to,
  cc: args.cc,
  bcc: args.bcc,
  subject: args.subject,
  text: args.text,
  html: args.html,
  replyTo: args.reply_to,
});

export const READ = { readOnlyHint: true, openWorldHint: true } as const;
export const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: true } as const;
export const DESTROY = { readOnlyHint: false, destructiveHint: true, openWorldHint: true } as const;

/** Register every tool that is only an API call. `signInHint` is what to say when the caller is not signed in. */
export function registerApiTools(server: McpServer, pidgeon: Pidgeon, signInHint?: string): void {
  const answer = (work: () => Promise<unknown>) => run(work, signInHint);

  server.registerTool(
    'list_agents',
    {
      title: 'List agents',
      description: 'The account’s agents.',
      inputSchema: { cursor: z.string().optional() },
      annotations: READ,
    },
    ({ cursor }) => answer(() => pidgeon.agents.list({ cursor })),
  );

  server.registerTool(
    'get_agent',
    {
      title: 'Read an agent',
      description:
        'An agent: its published keys (public facts only), its directory and its operator’s reputation.',
      inputSchema: { agent_id: z.string().uuid() },
      annotations: READ,
    },
    ({ agent_id }) => answer(() => pidgeon.agents.get(agent_id)),
  );

  server.registerTool(
    'get_reputation',
    {
      title: 'Read reputation',
      description:
        'How websites treat the account’s agents: the band (unverified, new, good, flagged, suspended), what it means, and what would raise it. Reputation belongs to the operator, so every agent of the account shares it.',
      inputSchema: {
        agent_id: z
          .string()
          .uuid()
          .optional()
          .describe('Any of the account’s agents; the first if left out.'),
      },
      annotations: READ,
    },
    ({ agent_id }) =>
      answer(async () => {
        const id = agent_id ?? (await pidgeon.agents.list({ limit: 1 })).data[0]?.id;
        if (!id)
          return { reputation: null, note: 'The account has no agents yet: set_up_agent first.' };
        const agent = await pidgeon.agents.get(id);
        return { agent_id: agent.id, ...agent.reputation };
      }),
  );

  // ----------------------------------------------------------------- Email

  server.registerTool(
    'list_inboxes',
    {
      title: 'List inboxes',
      description: 'The account’s inboxes.',
      inputSchema: { cursor: z.string().optional() },
      annotations: READ,
    },
    ({ cursor }) => answer(() => pidgeon.inboxes.list({ cursor })),
  );

  server.registerTool(
    'get_inbox',
    {
      title: 'Read an inbox',
      description: 'One inbox.',
      inputSchema: { inbox_id: z.string().uuid() },
      annotations: READ,
    },
    ({ inbox_id }) => answer(() => pidgeon.inboxes.get(inbox_id)),
  );

  server.registerTool(
    'create_inbox',
    {
      title: 'Make an inbox',
      description:
        'Make an inbox. `name` is the part before the @. Pass agent_id to make it that agent’s: its mail then carries its signed declaration (binding needs a verified domain).',
      inputSchema: {
        name: z.string().min(1).max(64),
        kind: z.enum(['agent', 'shared', 'person', 'events']).default('agent'),
        agent_id: z.string().uuid().optional(),
        display_name: z.string().max(120).optional(),
        pod_id: z.string().uuid().optional(),
      },
      annotations: WRITE,
    },
    (args) =>
      answer(() =>
        pidgeon.inboxes.create({
          name: args.name,
          kind: args.kind,
          agentId: args.agent_id,
          displayName: args.display_name,
          podId: args.pod_id,
        }),
      ),
  );

  server.registerTool(
    'remove_inbox',
    {
      title: 'Remove an inbox',
      description: 'Remove an inbox. Its address is retired and never given to anyone again.',
      inputSchema: { inbox_id: z.string().uuid() },
      annotations: DESTROY,
    },
    ({ inbox_id }) =>
      answer(async () => (await pidgeon.inboxes.remove(inbox_id), { removed: inbox_id })),
  );

  server.registerTool(
    'send_message',
    {
      title: 'Send an email',
      description:
        'Send from an inbox now. The answer’s status is sent, or held when the account’s reputation needs a person to approve it first.',
      inputSchema: { inbox_id: z.string().uuid(), ...messageShape },
      annotations: WRITE,
    },
    ({ inbox_id, ...message }) => answer(() => pidgeon.messages.send(inbox_id, asMessage(message))),
  );

  server.registerTool(
    'create_draft',
    {
      title: 'Draft an email',
      description:
        'Write a draft in an inbox. Nothing is sent until send_draft, or a person approves it after request_approval.',
      inputSchema: { inbox_id: z.string().uuid(), ...messageShape },
      annotations: WRITE,
    },
    ({ inbox_id, ...message }) => answer(() => pidgeon.drafts.create(inbox_id, asMessage(message))),
  );

  server.registerTool(
    'get_draft',
    {
      title: 'Read a draft',
      description: 'A draft, or a message held or scheduled.',
      inputSchema: { draft_id: z.string().uuid() },
      annotations: READ,
    },
    ({ draft_id }) => answer(() => pidgeon.drafts.get(draft_id)),
  );

  server.registerTool(
    'update_draft',
    {
      title: 'Edit a draft',
      description: 'Replace a draft’s addresses and body.',
      inputSchema: { draft_id: z.string().uuid(), ...messageShape },
      annotations: WRITE,
    },
    ({ draft_id, ...message }) => answer(() => pidgeon.drafts.update(draft_id, asMessage(message))),
  );

  server.registerTool(
    'delete_draft',
    {
      title: 'Throw a draft away',
      description: 'Delete a draft, or a message held or scheduled.',
      inputSchema: { draft_id: z.string().uuid() },
      annotations: DESTROY,
    },
    ({ draft_id }) =>
      answer(async () => (await pidgeon.drafts.remove(draft_id), { deleted: draft_id })),
  );

  server.registerTool(
    'send_draft',
    {
      title: 'Send a draft',
      description: 'Send a draft now, or at send_at (ISO 8601, up to 90 days ahead).',
      inputSchema: { draft_id: z.string().uuid(), send_at: z.string().datetime().optional() },
      annotations: WRITE,
    },
    ({ draft_id, send_at }) => answer(() => pidgeon.drafts.send(draft_id, { sendAt: send_at })),
  );

  server.registerTool(
    'request_approval',
    {
      title: 'Ask a person to approve',
      description:
        'Hold a draft for a person of the account to send or reject in Pidgeon. Use it when the mail matters and a person should look first.',
      inputSchema: { draft_id: z.string().uuid() },
      annotations: WRITE,
    },
    ({ draft_id }) => answer(() => pidgeon.drafts.requestApproval(draft_id)),
  );

  server.registerTool(
    'list_rules',
    {
      title: 'List mail rules',
      description: 'The account’s send and receive rules.',
      annotations: READ,
    },
    () => answer(() => pidgeon.rules.list()),
  );

  server.registerTool(
    'add_rule',
    {
      title: 'Add a mail rule',
      description:
        'Allow or block an address, or a domain and its subdomains, for sending or receiving; for one inbox, or every inbox when inbox_id is left out.',
      inputSchema: {
        direction: z.enum(['send', 'receive']),
        action: z.enum(['allow', 'block']),
        pattern: z.string().describe('ana@example.com, or example.com'),
        inbox_id: z.string().uuid().optional(),
      },
      annotations: WRITE,
    },
    ({ direction, action, pattern, inbox_id }) =>
      answer(() => pidgeon.rules.create({ direction, action, pattern, inboxId: inbox_id })),
  );

  server.registerTool(
    'remove_rule',
    {
      title: 'Remove a mail rule',
      description: 'Remove a send or receive rule.',
      inputSchema: { rule_id: z.string().uuid() },
      annotations: DESTROY,
    },
    ({ rule_id }) =>
      answer(async () => (await pidgeon.rules.remove(rule_id), { removed: rule_id })),
  );

  server.registerTool(
    'list_suppressions',
    {
      title: 'List the do-not-send list',
      description:
        'Addresses the account will not send to: bounces, complaints, and ones added by hand.',
      annotations: READ,
    },
    () => answer(() => pidgeon.suppressions.list()),
  );

  // --------------------------------------------------------- the account

  server.registerTool(
    'list_events',
    {
      title: 'Read the event log',
      description:
        'What happened in the account, newest first: mail sent, received and held, keys, agents, sign-ins.',
      inputSchema: {
        type: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z.string().optional(),
      },
      annotations: READ,
    },
    (args) => answer(() => pidgeon.events.list(args)),
  );
}
