import type { z } from 'zod';

/**
 * A tool's input schema that reads `null` as "not given".
 *
 * Models send `null` for an option they mean to leave out. OpenAI's strict
 * function calling makes every field required and nullable, so a model trained
 * on it fills every option it does not want with `null` — and every optional
 * field here is `.optional()`, which accepts a missing key and refuses `null`.
 * The call failed validation before it reached the API, on an option the model
 * had correctly decided not to use.
 *
 * So `validate` drops top-level `null`s and then asks the object as it was.
 * What clients are told is unchanged: the JSON Schema is the object's own, so
 * nothing advertises `null` and no tool list grows. Top level only — a `null`
 * inside `data` is the caller's data. A required field sent as `null` is
 * still missing, and still refused.
 *
 * A Standard Schema rather than a zod one, because `registerTool` takes any.
 * The vendor is not `zod` so nothing that special-cases zod reads the object
 * directly and skips this `validate`.
 *
 * The MCP server's only (`index.ts`, so npm and `/api/mcp`). `@pidgeon-ai/
 * ai-sdk` hands out its schemas as zod objects, which its users read, so it
 * is not wrapped there.
 */
export function nullAsAbsent<T extends z.ZodObject>(object: T): NullAsAbsent<T> {
  const standard = object['~standard'];

  return {
    '~standard': {
      version: 1,
      vendor: 'pidgeon',
      validate: (value: unknown) => standard.validate(withoutNulls(value)),
      jsonSchema: standard.jsonSchema,
      types: standard.types,
    },
  } as NullAsAbsent<T>;
}

export type NullAsAbsent<T extends z.ZodObject> = { readonly '~standard': T['~standard'] };

/** A plain object without its `null` entries; anything else as it came. */
export function withoutNulls(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== null));
}
