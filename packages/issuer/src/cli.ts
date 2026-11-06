import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { generateIdentity } from '@pidgeon-ai/id';

import { loadConfig } from './config';
import { createIssuer } from './issuer';
import { serve } from './server';

/**
 * `pidgeon-issuer`: a Post issuer for your own domain, run inside your own
 * network. Nothing is sent to Pidgeon: not the key, not the agents.
 *
 *   pidgeon-issuer keygen acme.com      a key, the issuer's or an agent's, in a file only you hold
 *   pidgeon-issuer serve                the issuer, on PORT (default 8080)
 *   pidgeon-issuer dns                  the record to publish at _post.<domain>
 *   pidgeon-issuer export <dir>         the public documents, for a static host
 *
 * The config is `issuer.json` here, or `PIDGEON_ISSUER_CONFIG`.
 */

export class UsageError extends Error {}

const HELP = `pidgeon-issuer — a Post issuer for your own domain, inside your own network.

  keygen <domain> [--out <file>]   Make a key, the issuer's or an agent's (default ./pidgeon-issuer-key.json, mode 0600)
  serve                            Run the issuer on PORT (default 8080)
  dns                              Print the DNS records that make the domain findable
  export <dir>                     Write the public documents as static files

  --config <file>                  Default issuer.json, or PIDGEON_ISSUER_CONFIG`;

function option(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}

export async function runIssuer(
  args: string[],
  env: Record<string, string | undefined> = process.env,
  io: { log?: (line: string) => void } = {},
): Promise<string> {
  const [command, ...rest] = args;
  const configPath = option(rest, '--config') ?? env.PIDGEON_ISSUER_CONFIG ?? 'issuer.json';

  switch (command) {
    case 'keygen': {
      const domain = rest.find((arg) => !arg.startsWith('--') && arg !== option(rest, '--out'));
      if (!domain) throw new UsageError('keygen <domain>');
      const out = option(rest, '--out') ?? 'pidgeon-issuer-key.json';
      const identity = generateIdentity(domain);
      await mkdir(dirname(out), { recursive: true });
      const file = {
        v: 1,
        domain: identity.domain,
        kid: identity.kid,
        seed: Buffer.from(identity.seed).toString('base64url'),
        previous: null,
      };
      await writeFile(out, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
      await chmod(out, 0o600);
      return [
        `Wrote ${out}. Keep it secret.`,
        `  kid  ${identity.kid}`,
        `  key  ${Buffer.from(identity.publicKey).toString('base64url')}`,
        '',
        'For the issuer, name the file as `key` in issuer.json. For an agent, keep it where',
        `@pidgeon-ai/id looks (~/.config/pidgeon/id/${identity.domain}.json, or PIDGEON_ID_DIR)`,
        "and give the identity provider its `key` line: that is the agent's pidgeon.key.",
      ].join('\n');
    }
    case 'serve': {
      const issuer = createIssuer(await loadConfig(configPath, env));
      const port = Number(env.PORT ?? 8080);
      await serve(issuer, port);
      io.log?.(`Issuing for ${issuer.domain} as ${issuer.issuer}, on port ${port}.`);
      return new Promise<string>(() => {});
    }
    case 'dns': {
      const issuer = createIssuer(await loadConfig(configPath, env));
      const host = new URL(issuer.issuer).hostname;
      return [
        `_post.${issuer.domain}.  TXT  "${issuer.record()}"`,
        `${host}.  CNAME  <where this issuer, or its exported documents, answer publicly>`,
      ].join('\n');
    }
    case 'export': {
      const dir = rest.find((arg) => !arg.startsWith('--') && arg !== option(rest, '--config'));
      if (!dir) throw new UsageError('export <dir>');
      const issuer = createIssuer(await loadConfig(configPath, env));
      const written: string[] = [];
      for (const [path, body] of Object.entries(await issuer.documents())) {
        const target = join(dir, path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, body);
        written.push(path);
      }
      return `Wrote ${written.length} documents to ${dir}. Re-export when an agent or a key changes.`;
    }
    case undefined:
    case 'help':
    case '--help':
      return HELP;
    default:
      throw new UsageError(`Unknown command ${command}.\n\n${HELP}`);
  }
}
