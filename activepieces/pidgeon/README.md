# Pidgeon for Activepieces

**Email inboxes for AI agents, in Activepieces.** Give a flow its own address.
Mail that arrives starts the flow, and the flow replies, hands threads to
people and waits for verification codes.

[Pidgeon](https://pidgeon.ai/?utm_source=activepieces) · [Setup](https://pidgeon.ai/docs/activepieces?utm_source=activepieces)

- **Email Received** (trigger) starts a flow when mail arrives at an address.
  It makes its own webhook on Pidgeon when the flow is published, deletes it
  when the flow is turned off, and checks every delivery's signature.
- **Create Address**, **Send Email**, **Reply to Email**, **Update Thread**,
  **Wait for Code**, **Search Emails** and **Custom API Call**.

## Install

As the platform admin: **Platform Admin → Catalogue → Pieces → Install
Piece**, choose npm, and enter `@pidgeon-ai/piece-pidgeon`.

## The connection

Make a key at [pidgeon.ai/app/developers/keys](https://pidgeon.ai/app/developers/keys?utm_source=activepieces)
and paste it into a new Pidgeon connection. One address and one key per flow,
with the least access it needs: `read` for a trigger, `send` to reply or send.
A test key (`pgn_test_…`) works the same way, and nothing it sends leaves
Pidgeon.

## Building it

This directory is laid out as `packages/pieces/community/pidgeon` in
[activepieces/activepieces](https://github.com/activepieces/activepieces),
the only place a piece builds: Activepieces bundles its framework into each
piece and does not publish it to npm. From the Pidgeon repository,
`scripts/activepieces-piece.sh` clones Activepieces, copies this directory in,
and runs their build, lint and tests, then packs the `.tgz`.

`test/pidgeon.test.ts` runs against a mock of Activepieces' HTTP client.
`test/live.test.ts` runs every action and the trigger against production when
`PIDGEON_ADMIN_KEY` is set, on a test key it makes and deletes.

MIT licensed. [Open an issue](https://github.com/pidgeon-ai/pidgeon-js/issues),
or email [support@pidgeon.ai](mailto:support@pidgeon.ai).
