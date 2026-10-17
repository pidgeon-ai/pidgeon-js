# @pidgeon-ai/mcp

Pidgeon as a [Model Context Protocol](https://modelcontextprotocol.io) server:
a real mailbox your agent can read, answer and create addresses in.

## The credential is the whole of the access control

This hands an API key to a model. Nothing in this package decides what may be
reached — the key's own ceiling and the addresses it was granted do all of it,
server-side, exactly as for any other caller.

So **give it the narrowest key the agent needs**. A key created with `read`
access can never send, however generously it is granted a mailbox, and an
agent that only has to triage should have one.

## Installing it

```sh
PIDGEON_API_KEY=pgn_live_… npx -y @pidgeon-ai/mcp init
```

That checks the key against the API and tells you which addresses it reaches
— the one question a block of JSON cannot answer, and the one that otherwise
surfaces as a model quietly getting an error you never see. Then it writes
`.mcp.json` in the current directory and prints what it wrote.

`--print` to see the config without writing it, which is what you want if your
client keeps its own somewhere else. `--force` to replace an entry that is
already there.

The key is referenced from the environment rather than written into the file,
so the config can be committed and the credential cannot.

## Or by hand

```json
{
  "mcpServers": {
    "pidgeon": {
      "command": "npx",
      "args": ["-y", "@pidgeon-ai/mcp"],
      "env": { "PIDGEON_API_KEY": "${PIDGEON_API_KEY}" }
    }
  }
}
```

And to run the server directly, which is mostly useful for seeing it start:

```sh
PIDGEON_API_KEY=pgn_live_… npx -y @pidgeon-ai/mcp
```

`PIDGEON_BASE_URL` points it somewhere else, which is how you run it against a
local checkout.

## Tools

| Tool               | What it does                                                 |
| ------------------ | ------------------------------------------------------------ |
| `list_addresses`   | The addresses the key can reach; filter by `tenant_id`       |
| `create_address`   | A new address, optionally `reply_only` and with an end date  |
| `get_address`      | One address, its capabilities and its send policy            |
| `list_threads`     | Conversations in one address                                 |
| `get_thread`       | One conversation, by the `thread_id` a webhook gave you      |
| `list_messages`    | The messages of a conversation                               |
| `search_messages`  | Full-text within one mailbox                                 |
| `get_message`      | One message with its body — a webhook carries only its id    |
| `await_message`    | Wait for the next message, codes and links already extracted |
| `send_message`     | Send, subject to the address's send policy                   |
| `reply_to_message` | Answer one; recipients and subject come off the original     |
| `update_thread`    | Hand a conversation to a person, or take it back             |
| `update_message`   | Mark read, star, or move to archive, spam or trash           |
| `list_send_rules`  | Why a send was refused                                       |

## Handing a conversation to a person

The thing this product is for, and the four tools above are the loop: read a
message, answer it, file it, and say who owns it.

```
update_thread  id=<thread_id>  owner_type=human
```

It appears in the web inbox and `thread.updated` tells whatever was driving
the conversation that it no longer is. `owner_type=agent` takes it back,
`status` is the queue it sits in, and `assignee_id` names which person has it.

**These were missing until 13 October**, when somebody built a procurement
desk on this server and found they could not draft a reply or hand a thread
over — four operations that all existed in the API and none of which was
exposed here. The promise at the bottom of this file was not true; it is now.

## Two settings worth knowing about

An agent's address should usually be created **`reply_only`**: it can answer
anybody who has written to it and start a conversation with nobody, which is a
structural limit rather than a quantity. `create_address` takes it.

It can also be given an **end date**. An address per ticket or per invoice
stops accepting mail when the thing is over; expiry suspends the address and
keeps the correspondence.

## What this is not

A protocol adapter over an API that already exists, and nothing else. No
business logic, no database, no model, no state.

Every tool **is** an endpoint: the dispatcher works off the endpoint each tool
declares rather than off its name, so there is nowhere to put behaviour the
API does not have, and a test asserts each one exists in the published
OpenAPI document. If something is missing here, it is missing from the API,
and that is where it gets built.
