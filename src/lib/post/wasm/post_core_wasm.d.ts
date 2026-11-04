/* tslint:disable */
/* eslint-disable */

/**
 * A new 32-byte private key seed.
 */
export function generateSeed(): Uint8Array;

/**
 * What a receiver does with a signature before checking it
 * (`post_core::discovery::decide`): `verify`, `refuse`, or
 * `refetch-missing`, `refetch-expired`, `refetch-id`, `refetch-kid`.
 * Times are whole seconds since the epoch; `fetched_at` is absent when
 * nothing is held.
 */
export function policyDecision(now: number, fetched_at: number | null | undefined, max_age: number, cached_id: string | null | undefined, txt_id: string | null | undefined, kid_known: boolean): string;

/**
 * The `max_age` to cache a policy for, from the value it published
 * (`post_core::discovery::max_age`). Seconds.
 */
export function policyMaxAge(published?: number | null): number;

/**
 * The 32-byte public key for a seed.
 */
export function publicKey(seed: Uint8Array): Uint8Array;

/**
 * The 64-byte Ed25519 signature over `message` exactly as given.
 */
export function sign(seed: Uint8Array, message: Uint8Array): Uint8Array;

/**
 * Whether `signature` is `public_key`'s strict Ed25519 signature over `message`.
 */
export function verify(public_key: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly generateSeed: (a: number) => void;
    readonly policyDecision: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => void;
    readonly policyMaxAge: (a: number, b: number) => number;
    readonly publicKey: (a: number, b: number, c: number) => void;
    readonly sign: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly verify: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly __wbindgen_export: (a: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export3: (a: number, b: number) => number;
    readonly __wbindgen_export4: (a: number, b: number, c: number, d: number) => number;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
