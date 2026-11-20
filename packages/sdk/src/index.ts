/**
 * Pidgeon's TypeScript SDK: email inboxes for AI agents.
 *
 * `new Pidgeon({ apiKey })`: `.inboxes`, `.messages` and `.drafts` give an
 * agent its own address on @pidgeon.email or your domain, send from it and
 * wait for the reply; `.threads`, `.labels`, `.contacts`, `.attachments`,
 * `.domains` and `.calendar` are the rest of Email. For a platform, `.pods`
 * gives each of your users inboxes of their own.
 *
 * Sign in with Pidgeon: `.agents.setUp()` registers an agent, makes its key
 * here and publishes the public half; `signedFetch`, or `agentFromEnv().fetch`,
 * signs its requests; `.sites` and `.mandates` register sites and ask
 * people's permission. `generateAgentKey()` and `.publishKey()` make a key
 * where the agent runs and publish its public half.
 */
import {
  generateAgentKey,
  signAgentRequest,
  type AgentKeyPair,
  type PublicJwk,
} from './credential.ts';

export * from './credential.ts';
export { DECLARED_AGENT_TOKENS, declaredAgentToken } from './declared-agents.ts';

export const DEFAULT_BASE_URL = 'https://pidgeon.ai';

export type Band = 'unverified' | 'new' | 'good' | 'flagged' | 'suspended';

/**
 * What a check found (Patrick, 17 and 20 November), never saying more than
 * is true:
 * - `verified`: the signature holds and the key is a Pidgeon operator's.
 * - `signed_known`: it holds against a directory outside Pidgeon on Pidgeon's
 *   recognised list (`signature_agent.operator` names whose). Not verified.
 * - `signed_unknown`: it holds against a directory nobody vouches for.
 * - `declared`: not signed, but its User-Agent names an agent on Pidgeon's
 *   list (`declared` says which, and whether its address is the vendor's).
 *   Since 20 November 2026; such a request was `refused`, `unsigned` before.
 * - `refused`: unsigned, a bad signature, expired, revoked or replayed.
 */
export type CheckResult = 'verified' | 'signed_known' | 'signed_unknown' | 'declared' | 'refused';

/**
 * Who a `declared` agent says it is: the token of its User-Agent, its
 * vendor, what it is for, and whether its address is in the vendor's
 * published ranges (`confirmed`, `mismatch`), or could not be checked
 * (`unchecked`: no address sent, or the vendor publishes none).
 */
export type DeclaredAs = {
  name: string;
  operator: string;
  purpose: 'user' | 'search' | 'training';
  ip: 'confirmed' | 'mismatch' | 'unchecked';
};

/** Where on a website a check happens: a site rule is set per place. */
export type Place = 'signup' | 'checkout' | 'api' | 'other';

/** Who a place lets through: `any` agent but a flagged operator's, `known` (verified or recognised), or `verified` only. */
export type Requirement = 'any' | 'known' | 'verified';

/**
 * What a website's rule decided about a check:
 * - `allow`: Pidgeon vouches for the agent under the rule; the site may skip its own friction.
 * - `limit`: Pidgeon couldn't identify it, so the site's own rules decide.
 * - `block`: turn it away.
 * - `watch`: the place only watches; `would` says what it would have decided.
 */
export type Decision = 'allow' | 'limit' | 'block' | 'watch';

/** One place's rule. */
export type PlaceRule = { require: Requirement; enforce: boolean };

/** A website's rules: one per place. */
export type SiteRules = Record<Place, PlaceRule>;

/** What the rule made of a check. Absent from answers before 20 November 2026. */
export type RuleOutcome = {
  place: Place;
  decision: Decision;
  /** While watching: what the rule would have decided. */
  would?: Exclude<Decision, 'watch'>;
  /** One line: the place, its rule, and the agent. */
  rule: string;
};

/**
 * What `verify` answers. `valid` is true for `verified` only, as it always
 * was: an integration that reads only `valid` sees an agent from outside
 * Pidgeon as before, not valid with `reason: 'unknown_key'`. Read `result`
 * for the four.
 */
export type VerifyAnswer = Partial<RuleOutcome> &
  (
    | {
        valid: true;
        /** Absent from answers before 17 November 2026. */
        result?: 'verified';
        verification_id: string;
        agent: { id: string; name: string; purpose: string };
        operator: {
          id: string;
          name: string;
          kind: 'individual' | 'business';
          verification: 'none' | 'domain' | 'kyc' | 'kyb';
          country: string | null;
          since: string;
          /** The operator's verified domains. */
          domains?: string[];
        };
        reputation: { band: Band; seen_at_receivers: number; reports_90d: number; revoked: false };
        /**
         * Whether Pidgeon will refuse this signature if it is sent again: true
         * when it carries a nonce (every signature these SDKs make does).
         */
        replay_protected?: boolean;
        /** A signed verdict to hand a sign-up hook (`VerdictClaims`). Absent from answers before 19 November 2026. */
        verdict?: string;
      }
    | {
        valid: false;
        result: 'signed_known' | 'signed_unknown';
        verification_id: string;
        /** Pidgeon published no such key; the directory the signature names did. */
        reason: 'unknown_key';
        /** The directory the key came from, and the recognised operator behind it, if any. */
        signature_agent: { directory: string; host: string; operator: string | null };
        replay_protected?: boolean;
        /** As for `verified`: a signed verdict to hand a sign-up hook. */
        verdict?: string;
      }
    | {
        valid: false;
        result: 'declared';
        verification_id: string;
        /** It carries no signature. */
        reason: 'unsigned';
        declared: DeclaredAs;
      }
    | {
        valid: false;
        /** Absent from answers before 17 November 2026. */
        result?: 'refused';
        verification_id: string;
        /** `replayed`: this signature was verified before, so the request is a copy. */
        reason: 'unsigned' | 'invalid' | 'unknown_key' | 'expired' | 'revoked' | 'replayed';
        operator?: { id: string; name: string };
      }
  );

/**
 * One visit for `pidgeon.visits.record`: the request's method, the URL the
 * agent called (leave the query string out: it is never stored), its
 * User-Agent, the visitor's address (checked against the vendor's published
 * ranges, not stored), where on your site it was, and when (ISO 8601, within
 * the last hour).
 */
export type Visit = {
  method: string;
  url: string;
  user_agent: string;
  ip?: string;
  place?: Place;
  at?: string;
};

/** The header a proxy hands the verdict on in, to the app behind it. */
export const VERDICT_HEADER = 'pidgeon-verdict';

/** How long a verdict lasts after Pidgeon signs it. */
export const VERDICT_LIFETIME_SECONDS = 300;

/**
 * What a verdict says: a compact JWS (RS256, `typ` `pidgeon-verdict+jwt`)
 * that Pidgeon signs with the key it publishes at
 * `https://pidgeon.ai/.well-known/jwks.json`, when `/v1/verify` finds a
 * signature that holds (`verified`, `signed_known`, `signed_unknown`; never
 * for `refused`). It lets a sign-up hook that cannot see the agent's request
 * (Supabase, Auth0, WorkOS) trust what the website's proxy saw.
 */
export type VerdictClaims = {
  iss: string;
  /** The origin the agent signed its request for, as `https://shop.example`. */
  aud: string;
  /** The website's Pidgeon account, whose key asked. */
  receiver: string;
  /** The check it came from (`verification_id`); a verdict is spent once when checked with Pidgeon. */
  jti: string;
  iat: number;
  exp: number;
  result: 'verified' | 'signed_known' | 'signed_unknown';
  /** The signature's key id (its JWK thumbprint). */
  keyid: string;
  /** The agent's address as the website saw it, when the website said. */
  ip?: string;
  /** `verified` only. */
  agent?: { id: string; name: string };
  /** `verified` only. */
  operator?: {
    id: string;
    name: string;
    kind: 'individual' | 'business';
    verification: 'none' | 'domain' | 'kyc' | 'kyb';
    country: string | null;
  };
  /** `verified` only: the operator's reputation band when it was signed. */
  band?: Band;
  /** The two signed results: the outside directory the key came from. */
  signature_agent?: { directory: string; host: string; operator: string | null };
  /** The site's rule when it was signed (absent from verdicts before 20 November 2026): act on `decision`. */
  place?: Place;
  decision?: Decision;
  would?: Exclude<Decision, 'watch'>;
  rule?: string;
};

/** Why a verdict was refused. */
export type VerdictRefusal =
  'invalid' | 'expired' | 'wrong_site' | 'wrong_account' | 'wrong_ip' | 'used' | 'revoked';

/** What `checkVerdict` answers. */
export type VerdictCheck =
  { valid: true; verdict: VerdictClaims } | { valid: false; reason: VerdictRefusal };

export type ReportCategory = 'fraud' | 'abuse' | 'scraping' | 'spam' | 'fake_signups' | 'other';

export class PidgeonError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PidgeonError';
  }
}

/** An agent's request, as a website received it. */
export type IncomingRequest =
  | Request
  | {
      method: string;
      url: string;
      headers: Record<string, string | string[] | undefined> | Headers;
    };

function headersOf(input: IncomingRequest): Record<string, string> {
  const raw = input.headers;
  const out: Record<string, string> = {};
  if (raw instanceof Headers) {
    raw.forEach((value, name) => (out[name] = value));
    return out;
  }
  for (const [name, value] of Object.entries(raw)) {
    if (value !== undefined)
      out[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
  }
  return out;
}

/** A page of a `/v1` list: every list answers this shape. */
export type Page<T> = { data: T[]; has_more: boolean; next_cursor: string | null };

export type ListOptions = { limit?: number; cursor?: string };

/** What `messages.search` narrows by, beside the words. */
export type SearchOptions = ListOptions & { inboxId?: string; body?: BodyChoice };

/** An agent, as `/v1/agents` answers it. */
export type Agent = {
  id: string;
  name: string;
  purpose: string;
  status: 'active' | 'revoked';
  pod_id: string;
  created_at: string;
  revoked_at: string | null;
};

/** One agent in full: its published keys, its directory, and its operator's reputation. */
export type AgentDetail = Agent & {
  directory: string;
  keys: { kid: string; created_at: string; expires_at: string | null; revoked_at: string | null }[];
  reputation: { band: Band; seen: string; next: string | null };
};

/** `agent`: an agent's inbox (the default). `events`: receives only, as events. */
export type InboxKind = 'agent' | 'events';

export type Inbox = {
  id: string;
  address: string;
  kind: InboxKind;
  display_name: string | null;
  pod_id: string;
  agent_id: string | null;
  status: 'active' | 'suspended';
  /** Mail the Firewall calls suspicious waits for a person. */
  hold_suspicious: boolean;
  /** Added under mail a person writes from this address in the mail client. */
  signature: string | null;
  created_at: string;
};

/** The Firewall's reading of a received message. */
export type Firewall = {
  verdict: 'clean' | 'suspicious';
  signals: { kind: string; where: string; detail?: string }[];
  clean_text?: string;
  version: number;
};

export type Attachment = {
  id: string;
  filename: string;
  content_type: string;
  size: number;
  inline: boolean;
  content_id: string | null;
};

/** A message as the API serves it. A held one has `is_held` and nothing it says. */
export type Message = {
  id: string;
  thread_id: string;
  inbox_id: string;
  direction: 'in' | 'out';
  status: string;
  is_held: boolean;
  from: { address: string; name: string | null };
  to: string[];
  cc: string[];
  bcc?: string[];
  subject: string | null;
  text: string | null;
  html: string | null;
  spam: boolean | null;
  seen: boolean;
  test: boolean;
  attachments: Attachment[];
  firewall: Firewall | null;
  created_at: string;
  sent_at: string | null;
};

export type Thread = {
  id: string;
  inbox_id: string;
  subject: string | null;
  folder: 'inbox' | 'archive' | 'spam' | 'trash';
  starred: boolean;
  status: 'open' | 'waiting' | 'resolved' | 'human_review';
  owner_type: 'agent' | 'human' | 'automation';
  assignee_id: string | null;
  labels: { id: string; name: string; colour: string }[];
  message_count: number;
  unread_count: number;
  last_message_at: string;
  created_at: string;
};

export type Label = {
  id: string;
  inbox_id: string;
  name: string;
  colour: string;
  created_at: string;
};

export type Contact = {
  id: string;
  inbox_id: string;
  email: string;
  name: string | null;
  notes: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  edited_at: string | null;
  created_at: string;
};

export type MailDomain = {
  id: string;
  domain: string;
  mail: boolean;
  status: 'pending' | 'verified' | 'failed' | null;
  receiving: boolean;
  /** Whether Pidgeon signs agents' `Agent-of` here: the `pgn2._domainkey` record answered at the last check. */
  agent_signing: boolean;
  checked_at: string | null;
  records: {
    purpose: string;
    type: string;
    name: string;
    value: string;
    priority?: number;
    required: boolean;
  }[];
};

export type AppPassword = {
  id: string;
  inbox_id: string;
  name: string;
  prefix: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
  /** Answered once, when it is made. */
  password?: string;
};

export type CalendarEvent = {
  id: string;
  inbox_id: string;
  uid: string;
  title: string | null;
  /** Timed: an instant. All day: the first day, `YYYY-MM-DD`. */
  start: string;
  /** Timed: an instant. All day: the last day, inclusive. */
  end: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  /** The series' RRULE as written, or null for a one-off. */
  recurrence: string | null;
  description: string | null;
  location: string | null;
  /** The address organising it, when it has attendees. */
  organizer: string | null;
  attendees: { email: string; status: 'needs_action' | 'accepted' | 'declined' | 'tentative' }[];
  etag: string;
  created_at: string;
  updated_at: string;
  /** After a write with `sendInvites`: who was sent the invitation, or why nobody was. */
  invites?: { sent_to: string[]; error: string | null };
};

/** The events a webhook can carry; the event log (`events.list`) holds more. */
export const WEBHOOK_EVENTS = [
  'report.created',
  'reputation.changed',
  'operator.reputation_changed',
  'mandate.requested',
  'mandate.granted',
  'mandate.declined',
  'mandate.revoked',
  'message.received',
  'message.held',
  'message.released',
  'message.blocked',
  'message.quarantined',
  'message.sent',
  'message.failed',
  'message.scheduled',
  'message.delivered',
  'message.delayed',
  'message.bounced',
  'message.complained',
  'message.rejected',
  'message.exfiltration_blocked',
  'draft.created',
  'draft.approval_requested',
  'draft.approved',
  'draft.rejected',
  'thread.updated',
  'thread.deleted',
  'inbox.created',
  'inbox.updated',
  'inbox.removed',
  'email.domain_added',
  'email.domain_verified',
  'email.domain_broken',
  'email.domain_removed',
  'calendar.event.created',
  'calendar.event.updated',
  'calendar.event.deleted',
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];

export type Webhook = {
  id: string;
  url: string;
  events: WebhookEventType[];
  /** The inboxes it hears; null when it hears its pod, or the whole account. */
  inbox_ids: string[] | null;
  /** Its pod: the default pod's hear the whole account, another's that pod. */
  pod_id: string;
  created_at: string;
  disabled_at: string | null;
};

export type ApiKeyAccess = 'read' | 'draft' | 'send' | 'admin';

export type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  access: ApiKeyAccess;
  pod_id: string | null;
  test: boolean;
  created_at: string;
  last_used_at: string | null;
};

export type BodyChoice = 'original' | 'clean';

/** What to send, or what a draft says. `replyTo` is one of the inbox's messages. */
export type MessageInput = {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  text?: string;
  html?: string;
  replyTo?: string;
  /** Finished uploads of this inbox (`pidgeon.attachments.upload`). */
  attachmentIds?: string[];
};

/** What sending answers: `sent`, `held` for a person's approval, or `scheduled`. */
export type SendResult = { id: string; thread_id: string; status: 'sent' | 'held' | 'scheduled' };

/** A draft, or a message waiting (held for a person, or scheduled). */
export type Draft = {
  id: string;
  inbox_id: string;
  thread_id: string;
  status: 'draft' | 'held' | 'scheduled';
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  text: string | null;
  html: string | null;
  send_at: string | null;
};

/** A send or receive rule: an address, or a domain and its subdomains, allowed or blocked. */
export type Rule = {
  id: string;
  inbox_id: string | null;
  direction: 'send' | 'receive';
  action: 'allow' | 'block';
  pattern: string;
  created_at: string;
};

export type Suppression = { address: string; reason: string; created_at: string };

export type Event = {
  id: string;
  type: string;
  created_at: string;
  pod_id: string | null;
  data: Record<string, unknown>;
};

export type Pod = { id: string; name: string; default: boolean; created_at: string };

/** A site registered for Sign in with Pidgeon. `client_secret` is answered once, at creation and at each rotation. */
export type Site = {
  client_id: string;
  name: string;
  redirect_uris: string[];
  pod_id: string | null;
  created_at: string;
  client_secret?: string;
};

export type Mandate = {
  id: string;
  agent_id: string;
  client_id: string;
  scope: string;
  description: string;
  status: 'requested' | 'granted' | 'declined' | 'revoked';
  /** Asked with a test key: needs no verified domain, and every token under it says `test: true`. */
  test: boolean;
  expires_at: string;
  created_at: string;
  /** On a request: the link to send the person, and until when it works. */
  consent_url?: string;
  request_expires_at?: string;
};

const messageBody = (input: MessageInput) => ({
  to: input.to,
  cc: input.cc,
  bcc: input.bcc,
  subject: input.subject,
  text: input.text,
  html: input.html,
  reply_to: input.replyTo,
  attachment_ids: input.attachmentIds,
});

const segment = (id: string) => encodeURIComponent(id);

/**
 * The client for Pidgeon's API: the website's, the operator's, and a coding
 * agent's. Keep the API key on a server. `apiKey` is an API key (`pgn_…`) or
 * an OAuth access token (`pgn_oat_…`); `getToken` is asked before each
 * request instead, for a token that is refreshed.
 */
export class Pidgeon {
  private readonly token: () => Promise<string>;
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: {
    apiKey?: string;
    getToken?: () => Promise<string>;
    baseUrl?: string;
    fetch?: typeof fetch;
  }) {
    const { apiKey, getToken } = options;
    if (getToken) this.token = getToken;
    else if (apiKey) this.token = async () => apiKey;
    else throw new Error('Pidgeon needs an API key (Settings → API keys).');
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
  }

  /** Any `/v1` call: the methods below are this with the path and body filled in. */
  async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    options: {
      body?: unknown;
      query?: Record<string, string | number | undefined>;
      headers?: Record<string, string>;
    } = {},
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [name, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(name, String(value));
    }
    const response = await this.fetchImpl(url, {
      method,
      headers: {
        authorization: `Bearer ${await this.token()}`,
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...options.headers,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    if (response.status === 204) return undefined as T;
    const data = (await response.json().catch(() => null)) as
      (T & { error?: { code: string; message: string } }) | null;
    if (!response.ok) {
      throw new PidgeonError(
        response.status,
        data?.error?.code ?? 'error',
        data?.error?.message ?? `Pidgeon answered ${response.status}.`,
      );
    }
    return data as T;
  }

  // ---------------------------------------------------------------- Bouncer

  /**
   * Who stands behind an agent's request, and how they stand. Forward it as
   * you received it. `ip`, the agent's address as your server saw it, is
   * written into the answer's `verdict`, so a hook that sees the address can
   * hold the verdict to it.
   */
  verify(
    request: IncomingRequest,
    options: { ip?: string; place?: Place } = {},
  ): Promise<VerifyAnswer> {
    return this.request('POST', '/v1/verify', {
      body: {
        request: { method: request.method, url: request.url, headers: headersOf(request) },
        ...(options.ip ? { ip: options.ip } : {}),
        ...(options.place ? { place: options.place } : {}),
      },
    });
  }

  /**
   * Check a verdict with Pidgeon, for a sign-up hook: signed by Pidgeon, for
   * this account (and `origin`, and `ip`, when given), not expired, its key
   * and agent not revoked since, and never checked before. Spending it is
   * what an offline check (`verifyVerdict`, `@pidgeon-ai/sdk/verdict`)
   * cannot do.
   */
  checkVerdict(
    verdict: string,
    options: { origin?: string; ip?: string } = {},
  ): Promise<VerdictCheck> {
    return this.request('POST', '/v1/verify/verdict', {
      body: { verdict, ...options },
    });
  }

  /** Report an agent from one of your verifications: what it did, in your words. */
  report(input: {
    verificationId: string;
    category: ReportCategory;
    evidence: string;
  }): Promise<{ id: string }> {
    return this.request('POST', '/v1/reports', {
      body: {
        verification_id: input.verificationId,
        category: input.category,
        evidence: input.evidence,
      },
    });
  }

  // --------------------------------------------------------------- Passport

  /**
   * Publish an agent's public key. The request is signed with the key itself,
   * which is how Pidgeon knows you hold it; the private half never leaves you.
   */
  async publishKey(input: {
    agentId: string;
    key: AgentKeyPair;
    directory: string;
  }): Promise<{ kid: string }> {
    const path = `/v1/agents/${segment(input.agentId)}/keys`;
    const signature = await signAgentRequest(
      new Request(`${this.baseUrl}${path}`, { method: 'POST' }),
      { privateJwk: input.key.privateJwk, directory: input.directory },
    );
    return this.request('POST', path, {
      body: { public_jwk: input.key.publicJwk satisfies PublicJwk },
      headers: signature,
    });
  }

  readonly agents = {
    list: (options: ListOptions = {}): Promise<Page<Agent>> =>
      this.request('GET', '/v1/agents', { query: options }),
    /** Register an agent. It has no key until you make one where it runs and publish it. */
    create: (input: {
      name: string;
      purpose?: string;
      podId?: string;
    }): Promise<Agent & { directory: string }> =>
      this.request('POST', '/v1/agents', {
        body: { name: input.name, purpose: input.purpose ?? '', pod_id: input.podId },
      }),
    /** The agent, its keys, its directory and its operator's reputation. */
    get: (id: string): Promise<AgentDetail> => this.request('GET', `/v1/agents/${segment(id)}`),
    /** Rename the agent, or change what it does: what websites see when it arrives. */
    update: (id: string, input: { name?: string; purpose?: string }): Promise<Agent> =>
      this.request('PATCH', `/v1/agents/${segment(id)}`, {
        body: { name: input.name, purpose: input.purpose },
      }),
    /** Revoke the agent and every key it has. None verifies again; it cannot be undone. */
    revoke: (id: string): Promise<void> => this.request('DELETE', `/v1/agents/${segment(id)}`),
    /** Revoke one of the agent's keys, by its `kid`. Its other keys stay. */
    revokeKey: (id: string, kid: string): Promise<void> =>
      this.request('DELETE', `/v1/agents/${segment(id)}/keys/${segment(kid)}`),
    /**
     * Register an agent, make its key here, and publish the public half
     * signed with it. Keep `key.privateJwk` where the agent runs: it is the
     * agent's identity, and Pidgeon never sees it.
     */
    setUp: async (input: {
      name: string;
      purpose?: string;
      podId?: string;
    }): Promise<{ agent: Agent & { directory: string }; key: AgentKeyPair; kid: string }> => {
      const agent = await this.agents.create(input);
      const key = await generateAgentKey();
      const { kid } = await this.publishKey({
        agentId: agent.id,
        key,
        directory: agent.directory,
      });
      return { agent, key, kid };
    },
  };

  // ------------------------------------------------------------------ Email

  readonly inboxes = {
    list: (options: ListOptions = {}): Promise<Page<Inbox>> =>
      this.request('GET', '/v1/email/inboxes', { query: options }),
    get: (id: string): Promise<Inbox> => this.request('GET', `/v1/email/inboxes/${segment(id)}`),
    /** `name` is the part before the @. Bind an agent's inbox to it with `agentId`. */
    create: (input: {
      name: string;
      kind?: InboxKind;
      displayName?: string;
      agentId?: string;
      podId?: string;
      /** One of your own domains with mail on; `pidgeon.email` when left out. */
      domain?: string;
    }): Promise<Inbox> =>
      this.request('POST', '/v1/email/inboxes', {
        body: {
          name: input.name,
          kind: input.kind ?? 'agent',
          display_name: input.displayName,
          agent_id: input.agentId,
          pod_id: input.podId,
          domain: input.domain,
        },
      }),
    /** Hold suspicious mail for a person. A key can turn holding on, never off. */
    holdSuspicious: (id: string): Promise<Inbox> =>
      this.request('PATCH', `/v1/email/inboxes/${segment(id)}`, {
        body: { hold_suspicious: true },
      }),
    /** Set the lines the mail client adds under mail a person writes from it; null clears it. Needs `admin`. */
    setSignature: (id: string, signature: string | null): Promise<Inbox> =>
      this.request('PATCH', `/v1/email/inboxes/${segment(id)}`, {
        body: { signature },
      }),
    /** Remove an inbox. Its address is retired, never given to anyone again. */
    remove: (id: string): Promise<void> =>
      this.request('DELETE', `/v1/email/inboxes/${segment(id)}`),
  };

  readonly messages = {
    /** Send from an inbox: `status` is `sent`, or `held` while a person approves it. */
    send: (inboxId: string, input: MessageInput): Promise<SendResult> =>
      this.request('POST', `/v1/email/inboxes/${segment(inboxId)}/messages`, {
        body: messageBody(input),
      }),
    /** The inbox's mail, newest first. `body: 'clean'` serves the Firewall's cleaned text. */
    list: (
      inboxId: string,
      options: ListOptions & { body?: BodyChoice } = {},
    ): Promise<Page<Message>> =>
      this.request('GET', `/v1/email/inboxes/${segment(inboxId)}/messages`, { query: options }),
    get: (id: string, options: { body?: BodyChoice } = {}): Promise<Message> =>
      this.request('GET', `/v1/email/messages/${segment(id)}`, { query: options }),
    /** Mark a received message read, or unread. */
    markSeen: (id: string, seen = true): Promise<Message> =>
      this.request('PATCH', `/v1/email/messages/${segment(id)}`, { body: { seen } }),
    /**
     * Wait for mail: answers as soon as received mail newer than `since` (a
     * time or a message id; default now) is there, or after `timeout`
     * seconds (at most 50). Pass `next_since` back to wait for the next.
     */
    await: (
      inboxId: string,
      options: { since?: string; timeout?: number; body?: BodyChoice } = {},
    ): Promise<{ data: Message[]; held: number; next_since: string }> =>
      this.request('GET', `/v1/email/inboxes/${segment(inboxId)}/messages/await`, {
        query: options,
      }),
    /**
     * Mail by words in its subject, sender or text, newest first:
     * `search('invoice', { inboxId })`, or `search({ q: 'invoice', inboxId })`.
     */
    search: (
      query: string | (SearchOptions & { q: string }),
      options: SearchOptions = {},
    ): Promise<Page<Message>> => {
      const { q, ...rest } = typeof query === 'string' ? { ...options, q: query } : query;
      if (typeof q !== 'string' || !q.trim()) {
        return Promise.reject(
          new TypeError(
            'messages.search needs the words to look for: search("invoice") or search({ q: "invoice" }).',
          ),
        );
      }
      return this.request('GET', '/v1/email/search', {
        query: {
          q,
          inbox_id: rest.inboxId,
          limit: rest.limit,
          cursor: rest.cursor,
          body: rest.body,
        },
      });
    },
  };

  /** Conversations across your inboxes, and what is filed where. */
  readonly threads = {
    list: (
      options: ListOptions & {
        inboxId?: string;
        folder?: Thread['folder'];
        labelId?: string;
        status?: Thread['status'];
        starred?: boolean;
      } = {},
    ): Promise<Page<Thread>> =>
      this.request('GET', '/v1/email/threads', {
        query: {
          inbox_id: options.inboxId,
          folder: options.folder,
          label_id: options.labelId,
          status: options.status,
          starred: options.starred ? 'true' : undefined,
          limit: options.limit,
          cursor: options.cursor,
        },
      }),
    /** The conversation, and its messages oldest first. */
    get: (
      id: string,
      options: ListOptions & { body?: BodyChoice } = {},
    ): Promise<Thread & { messages: Page<Message> }> =>
      this.request('GET', `/v1/email/threads/${segment(id)}`, { query: options }),
    /** File, star or hand over: `{ ownerType: 'human', status: 'human_review' }` puts it before a person. */
    update: (
      id: string,
      input: {
        folder?: Thread['folder'];
        starred?: boolean;
        status?: Thread['status'];
        ownerType?: Thread['owner_type'];
        assigneeId?: string | null;
      },
    ): Promise<Thread> =>
      this.request('PATCH', `/v1/email/threads/${segment(id)}`, {
        body: {
          folder: input.folder,
          starred: input.starred,
          status: input.status,
          owner_type: input.ownerType,
          assignee_id: input.assigneeId,
        },
      }),
    /** Delete the conversation, its messages and files, for good. */
    remove: (id: string): Promise<void> =>
      this.request('DELETE', `/v1/email/threads/${segment(id)}`),
    addLabel: (id: string, labelId: string): Promise<Thread> =>
      this.request('POST', `/v1/email/threads/${segment(id)}/labels`, {
        body: { label_id: labelId },
      }),
    removeLabel: (id: string, labelId: string): Promise<Thread> =>
      this.request('DELETE', `/v1/email/threads/${segment(id)}/labels/${segment(labelId)}`),
  };

  /** An inbox's labels. */
  readonly labels = {
    list: (inboxId: string): Promise<{ data: Label[] }> =>
      this.request('GET', `/v1/email/inboxes/${segment(inboxId)}/labels`),
    create: (inboxId: string, input: { name: string; colour?: string }): Promise<Label> =>
      this.request('POST', `/v1/email/inboxes/${segment(inboxId)}/labels`, { body: input }),
    update: (id: string, input: { name?: string; colour?: string }): Promise<Label> =>
      this.request('PATCH', `/v1/email/labels/${segment(id)}`, { body: input }),
    remove: (id: string): Promise<void> =>
      this.request('DELETE', `/v1/email/labels/${segment(id)}`),
  };

  /** Files: those that arrived, and uploads to send. */
  readonly attachments = {
    /** Its details and a link to its bytes that lasts five minutes. */
    get: (id: string): Promise<Attachment & { url: string; expires_in: number }> =>
      this.request('GET', `/v1/email/attachments/${segment(id)}`),
    /** Upload a file to send (name its id in `attachmentIds`). Up to 25 MB; over 4 MB goes straight to storage. */
    upload: async (
      inboxId: string,
      file: { filename: string; contentType: string; content: Uint8Array | ArrayBuffer | Blob },
    ): Promise<Attachment> => {
      const blob =
        file.content instanceof Blob
          ? file.content
          : new Blob([file.content as BlobPart], { type: file.contentType });
      if (blob.size <= 4 * 1024 * 1024) {
        const form = new FormData();
        form.set('file', new File([blob], file.filename, { type: file.contentType }));
        return this.multipart(`/v1/email/inboxes/${segment(inboxId)}/attachments`, form);
      }
      const made = await this.request<Attachment & { upload: { url: string } }>(
        'POST',
        `/v1/email/inboxes/${segment(inboxId)}/attachments/uploads`,
        { body: { filename: file.filename, content_type: file.contentType, size: blob.size } },
      );
      const put = await this.fetchImpl(made.upload.url, {
        method: 'PUT',
        headers: { 'content-type': file.contentType },
        body: blob,
      });
      if (!put.ok) throw new PidgeonError(put.status, 'upload_failed', 'Storage refused the file.');
      return this.request('POST', `/v1/email/attachments/${segment(made.id)}/complete`, {
        body: {},
      });
    },
  };

  /** Who an inbox corresponds with. */
  readonly contacts = {
    list: (
      options: ListOptions & { inboxId?: string; search?: string } = {},
    ): Promise<Page<Contact>> =>
      this.request('GET', '/v1/email/contacts', {
        query: {
          inbox_id: options.inboxId,
          search: options.search,
          limit: options.limit,
          cursor: options.cursor,
        },
      }),
    get: (id: string): Promise<Contact> => this.request('GET', `/v1/email/contacts/${segment(id)}`),
    update: (
      id: string,
      input: { name?: string | null; notes?: string | null },
    ): Promise<Contact> =>
      this.request('PATCH', `/v1/email/contacts/${segment(id)}`, { body: input }),
    remove: (id: string): Promise<void> =>
      this.request('DELETE', `/v1/email/contacts/${segment(id)}`),
  };

  /** Each inbox's calendar. */
  readonly calendar = {
    list: (
      inboxId: string,
      options: ListOptions & { after?: string; before?: string } = {},
    ): Promise<Page<CalendarEvent>> =>
      this.request('GET', `/v1/email/inboxes/${segment(inboxId)}/events`, { query: options }),
    get: (id: string): Promise<CalendarEvent> =>
      this.request('GET', `/v1/email/events/${segment(id)}`),
    create: (
      inboxId: string,
      input: {
        title: string;
        start: string;
        /** Required for a timed event; for an all-day one, the last day (default the start). */
        end?: string;
        allDay?: boolean;
        description?: string;
        location?: string;
        /** Who is on it; writing the list sends nothing. */
        attendees?: string[];
        /** Invite them now (a key with `send` access): an email from the inbox with the `.ics`. */
        sendInvites?: boolean;
      },
    ): Promise<CalendarEvent> =>
      this.request('POST', `/v1/email/inboxes/${segment(inboxId)}/events`, {
        body: {
          title: input.title,
          start: input.start,
          end: input.end,
          all_day: input.allDay,
          description: input.description,
          location: input.location,
          attendees: input.attendees,
          send_invites: input.sendInvites,
        },
      }),
    update: (
      id: string,
      input: {
        title?: string;
        start?: string;
        end?: string;
        allDay?: boolean;
        /** `null` clears it. */
        description?: string | null;
        /** `null` clears it. */
        location?: string | null;
        attendees?: string[];
        /** Send the attendees the updated invitation (a key with `send` access). */
        sendInvites?: boolean;
      },
    ): Promise<CalendarEvent> =>
      this.request('PATCH', `/v1/email/events/${segment(id)}`, {
        body: {
          title: input.title,
          start: input.start,
          end: input.end,
          all_day: input.allDay,
          description: input.description,
          location: input.location,
          attendees: input.attendees,
          send_invites: input.sendInvites,
        },
      }),
    /** With `sendInvites`, the attendees are sent a cancellation first (a key with `send` access). */
    remove: (
      id: string,
      options: { sendInvites?: boolean } = {},
    ): Promise<void | { deleted: true; invites: { sent_to: string[]; error: string | null } }> =>
      this.request('DELETE', `/v1/email/events/${segment(id)}`, {
        query: options.sendInvites ? { send_invites: 'true' } : undefined,
      }),
  };

  /** Inboxes on your own domains. A key of the whole account only. */
  readonly domains = {
    list: (): Promise<{ data: MailDomain[] }> => this.request('GET', '/v1/email/domains'),
    get: (id: string): Promise<MailDomain> =>
      this.request('GET', `/v1/email/domains/${segment(id)}`),
    /** Turn mail on for a domain you proved; answers the DNS records to set. */
    enableMail: (id: string): Promise<MailDomain> =>
      this.request('POST', `/v1/email/domains/${segment(id)}/mail`, { body: {} }),
    disableMail: (id: string): Promise<void> =>
      this.request('DELETE', `/v1/email/domains/${segment(id)}/mail`),
    /** Ask DNS and the mail service where the domain stands now. */
    check: (id: string): Promise<MailDomain> =>
      this.request('POST', `/v1/email/domains/${segment(id)}/check`, { body: {} }),
  };

  /** Passwords for mail apps (IMAP, SMTP, CalDAV), one inbox each. */
  readonly appPasswords = {
    list: (inboxId: string): Promise<{ data: AppPassword[] }> =>
      this.request('GET', `/v1/email/inboxes/${segment(inboxId)}/app-passwords`),
    /** Answers `password` this once. */
    create: (inboxId: string, name: string): Promise<AppPassword> =>
      this.request('POST', `/v1/email/inboxes/${segment(inboxId)}/app-passwords`, {
        body: { name },
      }),
    revoke: (id: string): Promise<void> =>
      this.request('DELETE', `/v1/email/app-passwords/${segment(id)}`),
  };

  /** How much of the account's 10 GB its mail and files use. */
  storage(): Promise<{ used_bytes: number; limit_bytes: number }> {
    return this.request('GET', '/v1/email/storage');
  }

  /** With a test key: deliver a message to one of your inboxes as if from outside, marked test. */
  testInbound(input: {
    inboxId: string;
    from: string;
    fromName?: string;
    subject?: string;
    text?: string;
    html?: string;
    inReplyTo?: string;
  }): Promise<{ inbox_id: string; message_id: string | null; outcome: string | null }> {
    return this.request('POST', '/v1/email/test/inbound', {
      body: {
        inbox_id: input.inboxId,
        from: input.from,
        from_name: input.fromName,
        subject: input.subject,
        text: input.text,
        html: input.html,
        in_reply_to: input.inReplyTo,
      },
    });
  }

  readonly drafts = {
    create: (inboxId: string, input: MessageInput): Promise<Draft> =>
      this.request('POST', `/v1/email/inboxes/${segment(inboxId)}/drafts`, {
        body: messageBody(input),
      }),
    get: (id: string): Promise<Draft> => this.request('GET', `/v1/email/drafts/${segment(id)}`),
    /** Replace a draft's addresses and body; its thread stays, so `replyTo` is not taken. */
    update: (id: string, input: Omit<MessageInput, 'replyTo'>): Promise<Draft> =>
      this.request('PATCH', `/v1/email/drafts/${segment(id)}`, { body: messageBody(input) }),
    remove: (id: string): Promise<void> =>
      this.request('DELETE', `/v1/email/drafts/${segment(id)}`),
    /** Send now, or at `sendAt` (up to 90 days ahead). */
    send: (id: string, options: { sendAt?: Date | string } = {}): Promise<SendResult> =>
      this.request('POST', `/v1/email/drafts/${segment(id)}/send`, {
        body: {
          send_at: options.sendAt instanceof Date ? options.sendAt.toISOString() : options.sendAt,
        },
      }),
    /** Hold it for a person of the account to send or reject (`draft.approval_requested` carries the link). */
    requestApproval: (id: string): Promise<Draft> =>
      this.request('POST', `/v1/email/drafts/${segment(id)}/approval`, { body: {} }),
  };

  /** Send and receive rules, for one inbox or (`inboxId` left out) every inbox. Keys of the whole account only. */
  readonly rules = {
    list: (): Promise<{ data: Rule[] }> => this.request('GET', '/v1/email/rules'),
    create: (input: {
      direction: 'send' | 'receive';
      action: 'allow' | 'block';
      pattern: string;
      inboxId?: string;
    }): Promise<Rule> =>
      this.request('POST', '/v1/email/rules', {
        body: {
          direction: input.direction,
          action: input.action,
          pattern: input.pattern,
          inbox_id: input.inboxId ?? null,
        },
      }),
    remove: (id: string): Promise<void> => this.request('DELETE', `/v1/email/rules/${segment(id)}`),
  };

  /** The do-not-send list: bounces and complaints put addresses on it; you can too. */
  readonly suppressions = {
    list: (): Promise<{ data: Suppression[] }> => this.request('GET', '/v1/email/suppressions'),
    add: (address: string): Promise<{ address: string }> =>
      this.request('POST', '/v1/email/suppressions', { body: { address } }),
    remove: (address: string): Promise<void> =>
      this.request('DELETE', '/v1/email/suppressions', { query: { address } }),
  };

  // ------------------------------------------------------------------- Auth

  /** Sites registered for Sign in with Pidgeon. */
  readonly sites = {
    list: (): Promise<{ data: Site[] }> => this.request('GET', '/v1/auth/clients'),
    /** Answers `client_secret` once: keep it on the site's server. */
    create: (input: { name: string; redirectUris: string[]; podId?: string }): Promise<Site> =>
      this.request('POST', '/v1/auth/clients', {
        body: { name: input.name, redirect_uris: input.redirectUris, pod_id: input.podId },
      }),
    /** Rename it, or replace its return addresses (the whole list); its id and secret stay. */
    update: (clientId: string, input: { name?: string; redirectUris?: string[] }): Promise<Site> =>
      this.request('PATCH', `/v1/auth/clients/${segment(clientId)}`, {
        body: { name: input.name, redirect_uris: input.redirectUris },
      }),
    /** A new `client_secret`, answered once; the old one stops working at once. */
    rotateSecret: (clientId: string): Promise<Site & { client_secret: string }> =>
      this.request('POST', `/v1/auth/clients/${segment(clientId)}/rotate-secret`),
    remove: (clientId: string): Promise<void> =>
      this.request('DELETE', `/v1/auth/clients/${segment(clientId)}`),
  };

  /** A person's permission for one of your agents to act for them at one site. */
  readonly mandates = {
    list: (): Promise<{ data: Mandate[] }> => this.request('GET', '/v1/auth/mandates'),
    /** Answers `consent_url`: send it to the person, who allows or declines. */
    create: (input: {
      agentId: string;
      clientId: string;
      scope: string;
      description: string;
      days?: number;
    }): Promise<Mandate> =>
      this.request('POST', '/v1/auth/mandates', {
        body: {
          agent_id: input.agentId,
          client_id: input.clientId,
          scope: input.scope,
          description: input.description,
          days: input.days,
        },
      }),
    revoke: (id: string): Promise<void> =>
      this.request('DELETE', `/v1/auth/mandates/${segment(id)}`),
  };

  // ---------------------------------------------------------------- Account

  readonly events = {
    /** The account's event log, newest first. */
    list: (options: ListOptions & { type?: string } = {}): Promise<Page<Event>> =>
      this.request('GET', '/v1/events', { query: options }),
  };

  readonly pods = {
    list: (): Promise<{ data: Pod[] }> => this.request('GET', '/v1/pods'),
    create: (name: string): Promise<Pod> => this.request('POST', '/v1/pods', { body: { name } }),
    /** Rename a pod. Its id, and everything in it, stay as they are. */
    rename: (id: string, name: string): Promise<Pod> =>
      this.request('PATCH', `/v1/pods/${segment(id)}`, { body: { name } }),
    /**
     * Move an agent, an address (`inbox`), a domain, a webhook endpoint or a
     * site (by client id) into a pod. An agent takes its addresses and their
     * mail with it; an address that belongs to an agent moves only with it.
     */
    move: (
      id: string,
      thing: { type: 'agent' | 'inbox' | 'domain' | 'webhook' | 'site'; id: string },
    ): Promise<{ type: string; id: string; pod_id: string; moved_inboxes?: string[] }> =>
      this.request('POST', `/v1/pods/${segment(id)}/move`, { body: thing }),
    /** Remove an empty pod. Not the default pod, and not one with agents, domains or endpoints in it. */
    remove: (id: string): Promise<void> => this.request('DELETE', `/v1/pods/${segment(id)}`),
  };

  /**
   * Bouncer's site rules: per place, who gets in and whether the rule acts
   * or only watches. Reading takes any key; setting takes an admin key of the
   * whole account.
   */
  readonly siteRules = {
    get: (): Promise<SiteRules> => this.request('GET', '/v1/site-rules'),
    /** Change some places; the rest stay as they are. Answers every place. */
    set: (rules: Partial<Record<Place, Partial<PlaceRule>>>): Promise<SiteRules> =>
      this.request('PUT', '/v1/site-rules', { body: rules }),
  };

  /**
   * Visits of agents that only name themselves (`declared`), recorded in a
   * batch after the responses, not counted as verifications. Up to 100 a
   * call; a User-Agent not on Pidgeon's list is skipped, not stored. Send
   * signed requests to `verify`. `bouncer()` (`@pidgeon-ai/sdk/next`) does
   * this for you.
   */
  readonly visits = {
    record: (visits: Visit[]): Promise<{ recorded: number; skipped: number }> =>
      this.request('POST', '/v1/visits', { body: { visits } }),
  };

  /** Your API keys. Making and revoking takes an admin key of the whole account. */
  readonly keys = {
    list: (): Promise<{ data: ApiKey[] }> => this.request('GET', '/v1/keys'),
    /** Answers `key` once. Never stronger than the key making it; a test key makes test keys. */
    create: (input: {
      name: string;
      access?: ApiKeyAccess;
      podId?: string;
      test?: boolean;
    }): Promise<{ id: string; key: string; prefix: string }> =>
      this.request('POST', '/v1/keys', {
        body: { name: input.name, access: input.access, pod_id: input.podId, test: input.test },
      }),
    revoke: (id: string): Promise<void> => this.request('DELETE', `/v1/keys/${segment(id)}`),
  };

  /** Your webhook endpoints. A key of the whole account only. */
  readonly webhooks = {
    list: (): Promise<{ data: Webhook[] }> => this.request('GET', '/v1/webhooks'),
    /**
     * Answers `secret` once: check each delivery's signature with it (`verifyWebhook`).
     * With `inboxIds` it hears only those inboxes' events. `podId` puts it in a
     * pod, where it hears that pod's events; left out, the default pod, where it
     * hears the whole account. A key of one pod adds to its own pod only.
     */
    create: (input: {
      url: string;
      events: WebhookEventType[];
      inboxIds?: string[];
      podId?: string;
    }): Promise<{ id: string; secret: string }> =>
      this.request('POST', '/v1/webhooks', {
        body: {
          url: input.url,
          events: input.events,
          inbox_ids: input.inboxIds,
          pod_id: input.podId,
        },
      }),
    remove: (id: string): Promise<void> => this.request('DELETE', `/v1/webhooks/${segment(id)}`),
  };

  /** A multipart POST (uploads): the same authentication and errors as `request`. */
  private async multipart<T>(path: string, form: FormData): Promise<T> {
    const response = await this.fetchImpl(new URL(`${this.baseUrl}${path}`), {
      method: 'POST',
      headers: { authorization: `Bearer ${await this.token()}` },
      body: form,
    });
    const data = (await response.json().catch(() => null)) as
      (T & { error?: { code: string; message: string } }) | null;
    if (!response.ok) {
      throw new PidgeonError(
        response.status,
        data?.error?.code ?? 'error',
        data?.error?.message ?? `Pidgeon answered ${response.status}.`,
      );
    }
    return data as T;
  }
}

/** `fetch`, signed as your agent: every request carries its Web Bot Auth signature. */
export async function signedFetch(
  input: string | URL | Request,
  init: RequestInit | undefined,
  agent: { privateJwk: JsonWebKey; directory: string },
): Promise<Response> {
  const request = new Request(input, init);
  const signature = await signAgentRequest(request, agent);
  const headers = new Headers(request.headers);
  for (const [name, value] of Object.entries(signature)) headers.set(name, value);
  return fetch(new Request(request, { headers }));
}

/** Your agent, from `PIDGEON_AGENT_KEY` and `PIDGEON_DIRECTORY` (the dashboard gives both). */
export function agentFromEnv(env: Record<string, string | undefined> = process.env): {
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
} {
  const key = env.PIDGEON_AGENT_KEY;
  const directory = env.PIDGEON_DIRECTORY;
  if (!key || !directory) {
    throw new Error(
      'Set PIDGEON_AGENT_KEY and PIDGEON_DIRECTORY: your agent’s page on pidgeon.ai has both.',
    );
  }
  const privateJwk = JSON.parse(key) as JsonWebKey;
  return { fetch: (input, init) => signedFetch(input, init, { privateJwk, directory }) };
}

export { generateAgentKey };

/** A webhook Pidgeon sent you, once its signature checks out. */
export type WebhookPayload = {
  id: string;
  type: WebhookEventType;
  created: string;
  data: Record<string, unknown>;
};

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)),
  );
  return Array.from(mac, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Check a webhook's `Pidgeon-Signature` header against your endpoint's secret
 * and return the event, or throw. Pass the raw body as received, before any
 * JSON parsing. Signatures older than `toleranceSeconds` are refused, so a
 * captured delivery cannot be replayed later.
 */
export async function verifyWebhook(
  secret: string,
  rawBody: string,
  signatureHeader: string | null,
  options: { toleranceSeconds?: number; now?: Date } = {},
): Promise<WebhookPayload> {
  const parts = Object.fromEntries(
    (signatureHeader ?? '').split(',').map((part) => part.trim().split('=') as [string, string]),
  );
  const timestamp = Number(parts.t);
  if (!Number.isInteger(timestamp) || typeof parts.v1 !== 'string') {
    throw new PidgeonError(
      400,
      'invalid_signature',
      'The Pidgeon-Signature header is missing or malformed.',
    );
  }
  const now = Math.floor((options.now ?? new Date()).getTime() / 1000);
  if (Math.abs(now - timestamp) > (options.toleranceSeconds ?? 300)) {
    throw new PidgeonError(400, 'stale_signature', 'The webhook was signed too long ago.');
  }
  const expected = await hmacHex(secret, `${timestamp}.${rawBody}`);
  let same = expected.length === parts.v1.length;
  for (let i = 0; i < expected.length; i++) same = same && expected[i] === parts.v1[i];
  if (!same)
    throw new PidgeonError(400, 'invalid_signature', 'The webhook signature does not match.');
  return JSON.parse(rawBody) as WebhookPayload;
}
