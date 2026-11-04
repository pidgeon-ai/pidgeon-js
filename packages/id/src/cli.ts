import { DEFAULT_ID_URL, IdApiError, IdClient, type IdDomain } from './api';
import { SignInError, signInWithPidgeon } from './sign-in';
import {
  generateIdentity,
  identityDir,
  listIdentities,
  loadIdentity,
  saveIdentity,
  type StoredIdentity,
} from './keys';

/**
 * `pidgeon id`: an agent identity on your own domain, no account.
 *
 *   pidgeon id init acme.com        key made here, domain proved over DNS
 *   pidgeon id issue support-agent  card live at post.acme.com
 *   pidgeon id list | revoke <name> | rotate | check
 *   pidgeon id grant <name> …       what an agent may do, for whom, until when
 *   pidgeon id sign-in <site> --as <name>   Sign in with Pidgeon, as the agent
 *
 * Also `npx @pidgeon-ai/id <command>`, which is this without the `id`.
 * Cards renew themselves: each is signed for a day when it is read, for as
 * long as the domain's `_post` record stands.
 */

export class UsageError extends Error {}

export interface IdRunOptions {
  /** Progress, while `init` waits for DNS. Never the answer. */
  stderr?: (line: string) => void;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const HELP = `pidgeon id — a signed identity for your agents, on your own domain. No account.

  init <domain>          Make a key on this machine and prove the domain over DNS
  check [<domain>]       Look at DNS again
  issue <name>           Give <name>@<domain> a card   --kind agent|service  --on-behalf-of <who>
  list                   Agents on the domain
  revoke <name>          Withdraw an agent's card now
  rotate                 Replace the domain's key; the old one verifies for another day
  grant <name>           Grant <name> what it may do, as the domain
                           --scope bookings.change --label "manage bookings"
                           --subject customer:42  --audience delta.com  --days 30
  revoke-grant <id>      Take a grant back now
  sign-in <site>         Sign in to a site as an agent   --as <name>  --grant <jws>

  --domain <domain>      Which domain, when this machine holds more than one
  --json                 Print the API's answer as JSON
  --no-wait              init: print the records and return

Keys live in ${'$'}PIDGEON_ID_DIR (default ~/.config/pidgeon/id). They never leave this machine.`;

interface Args {
  positional: string[];
  flags: Map<string, string | true>;
}

function parse(argv: string[]): Args {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const [name, inline] = token.slice(2).split('=', 2) as [string, string | undefined];
    if (['json', 'no-wait', 'help'].includes(name)) flags.set(name, true);
    else {
      const value = inline ?? argv[++i];
      if (value === undefined) throw new UsageError(`--${name} needs a value.`);
      flags.set(name, value);
    }
  }
  return { positional, flags };
}

const DOMAIN = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function baseUrl(env: Record<string, string | undefined>): string {
  if (env.PIDGEON_ID_URL) return env.PIDGEON_ID_URL;
  // The main CLI's base, `…/api/v1`, names the same host.
  if (env.PIDGEON_BASE_URL) return env.PIDGEON_BASE_URL.replace(/\/v1\/?$/, '/id');
  return DEFAULT_ID_URL;
}

function describeRecords(domain: IdDomain): string[] {
  const lines = domain.records.map(
    (record) =>
      `  ${record.found ? '✓' : '·'} ${record.type.padEnd(5)} ${`${record.name}.${domain.domain}`.padEnd(28)} ${record.value}`,
  );
  return lines;
}

export async function runId(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
  options: IdRunOptions = {},
): Promise<string> {
  const { positional, flags } = parse(argv);
  const [command, ...rest] = positional;
  if (!command || flags.has('help') || command === 'help') return HELP;

  const dir = identityDir(env);
  const json = flags.has('json');
  const say = options.stderr ?? (() => {});
  const sleep =
    options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const client = (identity: StoredIdentity) => new IdClient(identity, baseUrl(env), options.fetch);

  async function which(): Promise<StoredIdentity> {
    const named = flags.get('domain');
    if (typeof named === 'string') return loadIdentity(named, { dir, env });
    if (env.PIDGEON_ID_KEY) return loadIdentity(env.PIDGEON_ID_KEY.split(':')[0]!, { dir, env });
    const held = await listIdentities(dir);
    if (held.length === 1) return loadIdentity(held[0]!, { dir, env });
    if (held.length === 0)
      throw new UsageError('No domain here yet. Start with `pidgeon id init <domain>`.');
    throw new UsageError(`This machine holds ${held.join(', ')}. Say which with --domain.`);
  }

  try {
    switch (command) {
      case 'init': {
        const domain = rest[0]?.trim().toLowerCase().replace(/\.$/, '');
        if (!domain || !DOMAIN.test(domain))
          throw new UsageError('Name the domain: `pidgeon id init acme.com`.');

        let identity: StoredIdentity;
        let made = false;
        try {
          identity = await loadIdentity(domain, { dir, env });
        } catch {
          identity = generateIdentity(domain);
          await saveIdentity(identity, dir);
          made = true;
        }

        let state = await client(identity).claim();
        if (json && (state.status === 'verified' || flags.has('no-wait')))
          return JSON.stringify(state, null, 2);

        const lines = [
          made
            ? `Made a signing key for ${domain} on this machine (${identity.kid}).`
            : `Using the key for ${domain} on this machine.`,
        ];
        if (state.status !== 'verified') {
          lines.push(
            '',
            state.setup_url
              ? `Add the records in one click: ${state.setup_url}\n\nOr add them by hand:`
              : 'Add these records at your DNS provider:',
            ...describeRecords(state),
            '',
            'The first proves the domain is yours. The second serves its keys and cards at',
            `post.${domain}; without it Pidgeon still verifies your agents, and nobody else can.`,
          );
          if (flags.has('no-wait')) return [...lines, '', 'Then: pidgeon id check'].join('\n');

          say(lines.join('\n'));
          say('\nWaiting for DNS…');
          const deadline = Date.now() + Number(flags.get('timeout') ?? 600) * 1000;
          while (state.status !== 'verified' && Date.now() < deadline) {
            await sleep(5000);
            state = await client(identity).check();
          }
          if (state.status !== 'verified') {
            return 'Not yet. DNS can take a while; run `pidgeon id check` once the record is in.';
          }
          lines.length = 0;
        }
        if (json) return JSON.stringify(state, null, 2);
        return [...lines, `${domain} is proved. Next: pidgeon id issue support-agent`]
          .join('\n')
          .trim();
      }

      case 'check': {
        const identity = rest[0] ? await loadIdentity(rest[0], { dir, env }) : await which();
        const state = await client(identity).check();
        if (json) return JSON.stringify(state, null, 2);
        return [
          `${state.domain}: ${state.status === 'verified' ? 'proved' : state.status}`,
          ...describeRecords(state),
        ].join('\n');
      }

      case 'issue': {
        const name = rest[0]?.trim().toLowerCase();
        if (!name) throw new UsageError('Name the agent: `pidgeon id issue support-agent`.');
        const identity = await which();
        const kind = flags.get('kind');
        if (kind !== undefined && kind !== 'agent' && kind !== 'service') {
          throw new UsageError('--kind is agent or service.');
        }
        const onBehalfOf = flags.get('on-behalf-of');
        const card = await client(identity).issue({
          name,
          ...(kind ? { kind } : {}),
          ...(typeof onBehalfOf === 'string' ? { on_behalf_of: onBehalfOf } : {}),
        });
        if (json) return JSON.stringify(card, null, 2);
        return [
          `${card.card.address} has a card: ${card.url}`,
          `Found from the address at https://post.${identity.domain}/.well-known/post/card?address=${card.card.address}`,
          'It renews itself. Sign with it: import { loadIdentity, signEmail, signedFetch } from "@pidgeon-ai/id".',
        ].join('\n');
      }

      case 'list': {
        const agents = await client(await which()).list();
        if (json) return JSON.stringify(agents, null, 2);
        if (agents.length === 0)
          return 'No agents yet. `pidgeon id issue <name>` gives one a card.';
        return agents
          .map((agent) => `${agent.address}  ${agent.kind}  ${agent.card_url}`)
          .join('\n');
      }

      case 'revoke': {
        const name = rest[0]?.trim().toLowerCase();
        if (!name) throw new UsageError('Name the agent: `pidgeon id revoke support-agent`.');
        const revoked = await client(await which()).revoke(name);
        if (json) return JSON.stringify(revoked, null, 2);
        return `${revoked.address} has no card from now on. Copies already fetched lapse within a day.`;
      }

      case 'rotate': {
        const current = await which();
        const next = generateIdentity(current.domain);
        const state = await client(current).rotate(next);
        next.previous = { kid: current.kid, publicKey: current.publicKey };
        await saveIdentity(next, dir);
        if (json) return JSON.stringify(state, null, 2);
        return `${current.domain} signs with ${next.kid} now. ${current.kid} still verifies for a day.`;
      }

      case 'grant': {
        const name = rest[0]?.trim().toLowerCase();
        const scope = flags.get('scope');
        const label = flags.get('label');
        const subject = flags.get('subject');
        if (!name || typeof scope !== 'string' || typeof label !== 'string') {
          throw new UsageError(
            'Name the agent and the scope: `pidgeon id grant support-agent --scope bookings.change --label "manage bookings" --subject customer:42`.',
          );
        }
        const [type, ...idParts] = typeof subject === 'string' ? subject.split(':') : [];
        if (!type || idParts.length === 0 || !['customer', 'account', 'order'].includes(type)) {
          throw new UsageError('--subject is customer:<id>, account:<id> or order:<id>.');
        }
        const days = flags.get('days');
        const audience = flags.get('audience');
        const grant = await client(await which()).grant({
          agent: name,
          scope: { name: scope, label },
          subject: { type: type as 'customer' | 'account' | 'order', id: idParts.join(':') },
          ...(typeof audience === 'string' ? { audience } : {}),
          ...(typeof days === 'string'
            ? { expires_at: new Date(Date.now() + Number(days) * 86_400_000).toISOString() }
            : {}),
        });
        if (json) return JSON.stringify(grant, null, 2);
        return [
          `${grant.agent} may ${grant.scope.label} for ${grant.subject.type} ${grant.subject.id}${grant.audience ? ` at ${grant.audience}` : ''}, until ${grant.expires_at}.`,
          `Grant ${grant.id}. The agent carries it as Post-Grant; --json prints the JWS.`,
        ].join('\n');
      }

      case 'revoke-grant': {
        const grantId = rest[0]?.trim();
        if (!grantId) throw new UsageError('Name the grant: `pidgeon id revoke-grant <id>`.');
        const revoked = await client(await which()).revokeGrant(grantId);
        if (json) return JSON.stringify(revoked, null, 2);
        return `Grant ${revoked.id} is revoked. The next check of it fails.`;
      }

      case 'sign-in': {
        const site = rest[0];
        const name = flags.get('as');
        if (!site || typeof name !== 'string') {
          throw new UsageError(
            'Name the site and the agent: `pidgeon id sign-in https://site.example/api/auth/pidgeon/token --as support-agent`.',
          );
        }
        const identity = await which();
        // `issue` answers a live agent's card as it is, so this is also how the agent reads its card.
        const card = await client(identity).issue({ name: name.trim().toLowerCase() });
        const grant = flags.get('grant');
        try {
          const signedIn = await signInWithPidgeon(identity, {
            agent: card.card.address,
            site,
            card: card.jws,
            ...(typeof grant === 'string' ? { grant } : {}),
            ...(options.fetch ? { fetch: options.fetch } : {}),
          });
          if (json) return JSON.stringify(signedIn.site, null, 2);
          return `Signed in to ${new URL(site).host} as ${card.card.address}.\n${JSON.stringify(signedIn.site, null, 2)}`;
        } catch (error) {
          if (error instanceof SignInError) throw new Error(`${error.step}: ${error.message}`);
          throw error;
        }
      }

      default:
        throw new UsageError(`No such command "${command}".\n\n${HELP}`);
    }
  } catch (error) {
    if (error instanceof IdApiError) {
      throw new Error(error.code ? `${error.code}: ${error.message}` : error.message);
    }
    throw error;
  }
}
