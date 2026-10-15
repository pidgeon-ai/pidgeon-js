import { z } from 'zod';

/**
 * The tools this server offers, and the endpoint each one is.
 *
 * **This is an adapter, and this file is where that stays true.** Every tool
 * names the `METHOD /path` it calls, and `tests/unit/mcp-adapter.test.ts`
 * asserts that pair exists in `public/openapi.json`. So a tool cannot be
 * added for behaviour the API does not have — if one needs logic that is not
 * an endpoint, **the API is missing it**, and it gets built there.
 *
 * That constraint is the whole reason this package is allowed to exist.
 * `architecture.md` §7 put MCP on the do-not-build list when this product was
 * email hosting, and the premise changed rather than the judgement: what is
 * sold now is a programmable mailbox, and the buyer is somebody building an
 * agent. A protocol adapter over an API already at parity is thin. An agent
 * runtime is not, and this file is what keeps the second from growing out of
 * the first. `decisions.md` §153.
 */

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  /** The endpoint this tool *is*. Checked against the published contract. */
  endpoint: `${'GET' | 'POST' | 'PATCH' | 'DELETE'} ${string}`;
  inputSchema: z.ZodRawShape;
  /** Whether it changes anything. MCP clients surface this before confirming. */
  readOnly: boolean;
}

/*
 * Deliberately not every endpoint.
 *
 * A tool list is a menu a model reads on every call, so length is a real
 * cost, and the ones left out are left out for reasons rather than by
 * omission: minting API keys and granting mailbox access are credential
 * operations that should be done by a person who can see what they are
 * agreeing to, and the raw attachment and export endpoints move bytes a
 * model has no use for. Anything here is something an agent doing the job
 * this product is for actually needs.
 */
export const TOOLS: ToolDefinition[] = [
  {
    name: 'list_addresses',
    title: 'List addresses',
    description:
      'The addresses this credential can reach. Use `tenant_id` to list the addresses ' +
      'belonging to one of your own customers.',
    endpoint: 'GET /identities',
    readOnly: true,
    inputSchema: {
      limit: z.number().int().min(1).max(200).optional(),
      cursor: z.string().optional(),
      tenant_id: z.string().optional(),
    },
  },
  {
    name: 'create_address',
    title: 'Create an address',
    description:
      'Create an address for an agent to use. Say where with `domain_id`, `domain` ' +
      '("yourdomain.com") or a whole `address` — every address you already have carries its ' +
      '`domain_id`. **`inbox` decides what it is**: with one, mail is stored and a person can ' +
      'open it; without one it becomes an event and your webhook fires. ' +
      '`send_policy: "reply_only"` makes it unable to write to anybody who has not written to ' +
      'it first, which is the right default for an agent. `expires_at` gives it an end date, ' +
      'after which it stops accepting mail.',
    endpoint: 'POST /identities',
    readOnly: false,
    inputSchema: {
      /*
       * Three ways to say where, because `domain_id` alone was a value an
       * agent could not obtain. `GET /domains` lists what a workspace owns and
       * a shared domain is owned by nobody, so for an account that signed
       * itself up the id appeared nowhere — a customer read it out of the
       * production database on 13 October. Every address carries its
       * `domain_id` now, and `domain` or a whole `address` work too.
       */
      domain_id: z.string().optional(),
      domain: z.string().optional(),
      address: z.string().optional(),
      local_part: z.string().optional(),
      /*
       * Whether it keeps mail, which is the only thing that decides what an
       * address can do. `type` is a label now — see `capabilities.ts`.
       */
      inbox: z.boolean().optional(),
      display_name: z.string().nullish(),
      type: z.enum(['human', 'team', 'application', 'workflow', 'agent']).optional(),
      send_policy: z.enum(['open', 'reply_only', 'list']).optional(),
      expires_at: z.string().optional(),
      tenant_id: z.string().optional(),
    },
  },
  {
    name: 'get_address',
    title: 'Read one address',
    description:
      'One address, by id. Answers its type, its capabilities, its send policy and its end ' +
      'date, which is how to check what an address is allowed to do before using it.',
    endpoint: 'GET /identities/{id}',
    readOnly: true,
    inputSchema: { id: z.string() },
  },
  {
    name: 'list_threads',
    title: 'List conversations',
    description:
      'Conversations in one address, newest first. Filter by `status` for the queue an agent ' +
      'should be working, by `owner_type` for what kind of thing is answering, or by ' +
      '`assignee_id` for what one person has taken — `unassigned` is the queue nobody has.',
    endpoint: 'GET /threads',
    readOnly: true,
    /*
     * **The schema had three of these and the description promised five.**
     * Reported by a customer as a contradiction, and it was the schema that
     * was short: the route has honoured all of them since it was written, and
     * `GET /threads` published none of them because it declared
     * `paginationSchema` — so every generated client was missing them too.
     * Fixed in `listThreadsSchema`; this mirrors it.
     */
    inputSchema: {
      identity_id: z.string().optional(),
      status: z.enum(['open', 'waiting', 'resolved', 'human_review']).optional(),
      owner_type: z.enum(['human', 'automation', 'agent']).optional(),
      assignee_id: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional(),
      cursor: z.string().optional(),
    },
  },
  {
    name: 'get_thread',
    title: 'Read a conversation',
    description:
      'One conversation, by id. Every webhook payload carries a `thread_id`, so this is how a ' +
      'handler turns an event into the conversation it is about.',
    endpoint: 'GET /threads/{id}',
    readOnly: true,
    inputSchema: { id: z.string() },
  },
  {
    name: 'list_messages',
    title: 'List messages in a conversation',
    description:
      'The messages of one conversation, oldest first — the text to read before replying. ' +
      'Bodies are here; attachments are metadata only.',
    endpoint: 'GET /messages',
    readOnly: true,
    inputSchema: {
      thread_id: z.string(),
      limit: z.number().int().min(1).max(200).optional(),
      cursor: z.string().optional(),
    },
  },
  {
    name: 'search_messages',
    title: 'Search messages',
    description:
      'Full-text search across every address this credential can reach, ranked by relevance. ' +
      'Name an `identity_id` to search exactly one. Every result carries the `identity_id` it ' +
      'was found in, because a hit you cannot attribute to an address is a hit you cannot open.',
    endpoint: 'GET /messages/search',
    readOnly: true,
    /*
     * `identity_id` is optional here because it became optional on the
     * endpoint, and this tool said "one mailbox at a time" for weeks after
     * that stopped being true — a tool narrower than the endpoint it adapts
     * is the one thing this package is not allowed to be. An agent reading
     * the description concluded that *"where did that invoice go"* was not a
     * question Pidgeon could answer, which it had been for a while.
     */
    inputSchema: {
      identity_id: z.string().optional(),
      q: z.string(),
      limit: z.number().int().min(1).max(200).optional(),
    },
  },
  {
    name: 'send_message',
    title: 'Send a message',
    description:
      'Send from an address this credential may send as. Refused if the address’s send ' +
      'policy does not permit the recipient, or if the recipient previously bounced or ' +
      'reported mail as spam.',
    endpoint: 'POST /messages',
    readOnly: false,
    /*
     * **This tool could not have worked.** It declared `identity_id` and
     * `thread_id` — `POST /messages` accepts neither, and its schema is
     * `.strict()` — and it omitted `from`, which is required. `call.ts` sends
     * the input as the body verbatim by design, so every call was a 400.
     *
     * A customer reported the smaller half, that `send_message` takes a
     * `thread_id` the REST route does not. The route was right; the tool was
     * describing an API that does not exist. `mcp-adapter.test.ts` checked
     * that the `METHOD /path` pair is real and never that the *fields* were,
     * which is the gap — it checks both now.
     *
     * `in_reply_to` is how a message joins a conversation. There is no
     * `thread_id` on send and there never was: the thread is derived from
     * what you are answering.
     */
    inputSchema: {
      from: z.string(),
      to: z.union([z.string(), z.array(z.string())]),
      cc: z.union([z.string(), z.array(z.string())]).optional(),
      bcc: z.union([z.string(), z.array(z.string())]).optional(),
      subject: z.string().optional(),
      text: z.string().optional(),
      html: z.string().optional(),
      attachment_ids: z.array(z.string()).optional(),
      in_reply_to: z.string().optional(),
    },
  },
  /*
   * ---------------------------------------------------------------------
   * The desk: reading one message, answering it, and saying who has it.
   *
   * **Without these the product's headline cannot be done over MCP.** A
   * customer built a procurement agent on 13 October with a human
   * procurement desk on this server and found it could not *"draft a counter
   * to supplier B"* or *"hand Ferrum back to the agent"* — the four
   * operations those need all exist in the API and none was exposed. This
   * README's own promise is *if something is missing here, it is missing
   * from the API*, and that was not true.
   *
   * Four and not ten. The menu is read on every call, so `reply-all`,
   * `forward`, the bulk `actions` endpoint, `undo`, `raw` and the label
   * endpoints stay out: `reply` covers the common answer, bulk and undo are
   * affordances for a person with a list in front of them, and raw bytes are
   * no use to a model. These four are the loop — read it, answer it, file
   * it, say who owns it.
   * ---------------------------------------------------------------------
   */
  {
    name: 'get_message',
    title: 'Read one message',
    description:
      'One message, by id, with its body and its headers. **A webhook carries ids and never ' +
      'a body**, so this is how a handler turns `message.received` into the thing it is ' +
      'about.',
    endpoint: 'GET /messages/{id}',
    readOnly: true,
    inputSchema: { id: z.string() },
  },
  {
    name: 'reply_to_message',
    title: 'Reply to a message',
    description:
      'The recipients, the subject and the thread are read off the message being answered, ' +
      'so you bring the words and nothing else. Use `to` only to change who it goes to.',
    endpoint: 'POST /messages/{id}/reply',
    readOnly: false,
    inputSchema: {
      id: z.string(),
      text: z.string().optional(),
      html: z.string().optional(),
      to: z.union([z.string(), z.array(z.string())]).optional(),
      cc: z.union([z.string(), z.array(z.string())]).optional(),
      bcc: z.union([z.string(), z.array(z.string())]).optional(),
      attachment_ids: z.array(z.string()).optional(),
    },
  },
  {
    name: 'update_thread',
    title: 'Hand a conversation over, or take it back',
    description:
      'Who owns a conversation and where it has got to. `owner_type: "human"` hands it to a ' +
      'person — it appears in the web inbox and `thread.updated` tells whatever was driving ' +
      'it that it no longer is; `"agent"` takes it back. `status` is the queue it sits in, ' +
      'and `assignee_id` names which person has it.',
    endpoint: 'PATCH /threads/{id}',
    readOnly: false,
    inputSchema: {
      id: z.string(),
      status: z.enum(['open', 'waiting', 'resolved', 'human_review']).optional(),
      owner_type: z.enum(['human', 'automation', 'agent']).optional(),
      assignee_id: z.string().optional(),
    },
  },
  {
    name: 'update_message',
    title: 'File a message',
    description:
      'Mark one read or unread, star it, or move it to `archive`, `spam` or `trash`. An ' +
      'agent that has dealt with something should be able to say so, or the inbox it is ' +
      'working is the same length tomorrow.',
    endpoint: 'PATCH /messages/{id}',
    readOnly: false,
    inputSchema: {
      id: z.string(),
      is_read: z.boolean().optional(),
      is_starred: z.boolean().optional(),
      folder: z.enum(['inbox', 'archive', 'spam', 'trash']).optional(),
    },
  },
  {
    name: 'list_send_rules',
    title: 'What an address may write to',
    description:
      'The allow and block list of one address, and the send policy it hangs off. Read this ' +
      'when a send was refused.',
    endpoint: 'GET /identities/{id}/send-rules',
    readOnly: true,
    inputSchema: { id: z.string() },
  },
  /*
   * The inbound mirror, and read-only for the same reason `list_send_rules`
   * is: an agent debugging "why did nothing arrive" needs to see the rules,
   * and an agent that can *write* them can quietly stop its own mail. Making
   * a rule is a decision with a person behind it — the dashboard, or an
   * explicit API call somebody wrote.
   */
  {
    name: 'list_receive_rules',
    title: 'Who may write to an address',
    description:
      'The rules that decide what reaches one address — reject, spam, trash, archive or ' +
      'inbox, per sender or per domain. Read this when mail you expected did not arrive.',
    endpoint: 'GET /identities/{id}/receive-rules',
    readOnly: true,
    inputSchema: { id: z.string() },
  },
];
