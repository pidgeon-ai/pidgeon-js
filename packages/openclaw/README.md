# @pidgeon-ai/openclaw

Email for [OpenClaw](https://openclaw.ai). Mail to your agent's
[Pidgeon](https://pidgeon.ai) address starts an OpenClaw conversation, one per
email thread, and the agent's answer goes back as a reply in that thread. A
reply to the reply continues the same conversation.

```sh
openclaw plugins install @pidgeon-ai/openclaw
openclaw config set channels.pidgeon '{}' --strict-json
openclaw channels login --channel pidgeon
```

`channels login` opens Pidgeon's sign-in in your browser. You choose what the
channel can do and which addresses it reaches; the channel only needs read and
send. On a server with nobody there to sign in, give the Gateway an API key in
`PIDGEON_API_KEY` instead and skip the login.

Then check it:

```sh
openclaw channels status --channel pidgeon --probe
```

OpenClaw asks you to accept the plugin's capabilities when it installs; a
scripted install passes `--accept-capabilities`.

Requires OpenClaw 2026.10 or later. Pure TypeScript, no native code: run end
to end on macOS, and installed and loaded on Linux x64 and arm64.

## What reaches the agent

- **The Firewall's clean text.** The agent reads the email as a person
  would see it, with hidden text removed, never the raw HTML. Its
  sender, address, subject and attachment names come first.
- **Not spam, and not what the Firewall flags.** Mail Pidgeon filed as spam
  is never a turn. Mail [Pidgeon Firewall](https://pidgeon.ai/docs/firewall)
  marked suspicious — addressed to an AI, asking to send mail elsewhere — is
  held in the inbox, and `openclaw channels status` counts it. Set
  `"suspicious": "deliver"` to have it delivered with the warning instead.
- **An allowed sender only when it is them.** With `"dmPolicy":
"allowlist"`, mail from an address in `allowFrom` becomes a turn only when
  it passes DMARC, because anyone can forge a From. Mail between two Pidgeon
  addresses passes. Under `"open"` anyone can write anyway, so nothing is
  checked and the From the agent reads is a claim.
- **Only new mail.** A first start begins at the present; installing the
  channel does not answer a mailbox's history.

## How it stays up

It reads Pidgeon's event log every five seconds from a cursor kept in
OpenClaw's state store, and puts each message in OpenClaw's durable ingress
queue before the cursor moves. A dropped connection is one failed request; a
Gateway restart resumes from the cursor; mail sent while the Gateway was down
is answered when it is back. Every failure is retried and reported:
`channels status` says `recovering` with the reason, or `blocked` when it is
not signed in, never `running` while nothing arrives.

## Settings

All optional, under `channels.pidgeon` in `openclaw.json`:

| Setting                | Default                  | What it does                                                                                             |
| ---------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------- |
| `addresses`            | every address it reaches | Which of your addresses start conversations                                                              |
| `dmPolicy`             | `"open"`                 | `"allowlist"` to answer only `allowFrom`, `"disabled"` for nobody                                        |
| `allowFrom`            | `[]`                     | Senders for `"allowlist"`: `ana@customer.com`, or `@customer.com` for a domain                           |
| `allowUnauthenticated` | `false`                  | `true` trusts an allowed From that fails DMARC: anyone who knows the address can then instruct the agent |
| `suspicious`           | `"hold"`                 | `"deliver"` gives flagged mail to the agent with the Firewall's warning                                  |
| `pollSeconds`          | `5`                      | How often it reads new mail, from 2 to 300                                                               |
| `apiKeyEnv`            | `"PIDGEON_API_KEY"`      | The environment variable holding a key, when not signed in                                               |
| `baseUrl`              | `"https://pidgeon.ai"`   | Only for a Pidgeon you run yourself                                                                      |
| `accounts`             |                          | Named accounts, each with these settings; the top level is what they inherit                             |

Replies only: the agent answers the email in front of it, or another one by
`message:<id>`. It cannot write to a new recipient or start a new thread, so a
prompt in one email cannot send mail anywhere.

The full setup is at [pidgeon.ai/docs/openclaw](https://pidgeon.ai/docs/openclaw).
