# Changelog

## 1.0.0

- Rebuilt for the new Pidgeon: the tools are the hosted MCP server's
  (`registerApiTools` in `@pidgeon-ai/mcp`), built from its list, so the two
  never differ. Email, Passport, Bouncer, Auth and the account.
- `pidgeonTools({ apiKey, baseUrl, client, only })` and
  `pidgeonToolApproval(tools)`, which asks a person before the destructive
  tools.
- Removed: everything that spoke the old email API at `/api/v1` (addresses,
  `identityId`, `get_setup`, `check_message`, `verify_sender` and the other
  tools of the old server).
