/**
 * `@pidgeon-ai/sdk` — a typed client for the Pidgeon email API.
 *
 *   import { client, messagesSend, verifyWebhook } from '@pidgeon-ai/sdk';
 *
 *   client.setConfig({ baseUrl: 'https://pidgeon.ai/api/v1', auth: () => key });
 *   await messagesSend({ body: { from: 'hi@yours.test', to: ['a@b.test'] } });
 *
 * **Everything above `verifyWebhook` is generated** from
 * `public/openapi.json`, which is itself generated from the Zod schemas the
 * routes validate with and checked against real routes by
 * `tests/integration/api-contract.test.ts`. Adding an endpoint means editing
 * those schemas; this package is wrong until `pnpm sdk` regenerates it, and
 * `pnpm sdk:check` fails the build while it is.
 * `prd/one-source-of-capability.md` has the chain.
 *
 * **`messagesSend` rather than `messages.send`**, and the stutter is
 * deliberate: `openapi-python-client` builds `messages/messages_send.py`
 * from the same `operationId` and offers no way to rename it, so a prettier
 * TypeScript surface would cost the property that the two clients name every
 * operation the same thing. §343.
 *
 * `webhooks.ts` and `stream.ts` are the exceptions. HMAC over
 * `timestamp.body` is a security contract, not an endpoint; OpenAPI has
 * nothing to say about it, and a generator cannot produce it. Server-sent
 * events are the same shape of gap from the other end: the endpoint is in
 * the contract and generates a `fetch` that resolves once, which is not
 * what a held-open connection is.
 */

export * from './generated';

/*
 * The client itself, which the generated index does not export.
 *
 * Without it there is no way to set a base URL or an API key, so every
 * function in the package would call `https://pidgeon.ai/api/v1`
 * unauthenticated. Re-exported here rather than patched into the generated
 * file, because that file is overwritten on every `pnpm sdk`.
 */
export { client, type CreateClientConfig } from './generated/client.gen';
export { createClient, createConfig } from './generated/client';

export {
  verifyWebhook,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  type WebhookEnvelope,
} from './webhooks';

/*
 * The second exception, and the last one.
 *
 * `GET /events/stream` answers `text/event-stream`, and a generated client
 * builds a typed `fetch` that resolves once with a body — there is nowhere
 * in it for a connection that stays open. So `eventsStream` is in the types
 * and is not usable, and the endpoint the docs recommend to anybody who
 * cannot host a webhook was the one every customer wrote themselves.
 */
export { streamEvents, type StreamedEvent, type StreamOptions } from './stream';
