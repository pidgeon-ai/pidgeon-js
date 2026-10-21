/**
 * The plugin SDK as this plugin uses it, for CI.
 *
 * `openclaw` is 250 MB and the host provides it at runtime, so it is not a
 * dependency of this repository, and these declarations stand in for it in
 * `pnpm check`: only the calls made here, at the arity they are made. They
 * prove nothing about the real SDK. `pnpm --filter @pidgeon-ai/openclaw
 * sdk:check` does that, against a real OpenClaw 2026.10.x linked as
 * `node_modules/openclaw` (`tsconfig.sdk.json` leaves this file out).
 */

declare module 'openclaw/plugin-sdk/channel-core' {
  export type ChannelPlugin<_Account = unknown> = { id: string } & Record<string, unknown>;
  export function createChatChannelPlugin<Account>(
    options: Record<string, unknown>,
  ): ChannelPlugin<Account>;
}

declare module 'openclaw/plugin-sdk/channel-contract' {
  export interface ChannelGatewayContext<Account = unknown> {
    cfg: unknown;
    accountId: string;
    account: Account;
    abortSignal: AbortSignal;
    log?: { info(line: string): void; warn(line: string): void; error(line: string): void };
    getStatus(): Record<string, unknown>;
    setStatus(next: Record<string, unknown>): void;
  }
}

declare module 'openclaw/plugin-sdk/channel-outbound' {
  export function bindIngressLifecycleToReplyOptions(lifecycle: unknown): Record<string, unknown>;
  export function createChannelIngressError(name: string): new (message: string) => Error;
  export function createChannelIngressMonitor(options: Record<string, unknown>): {
    start(): void;
    stop(): Promise<void>;
    admit(raw: unknown): Promise<unknown>;
  };
}

declare module 'openclaw/plugin-sdk/routing' {
  export function resolveAgentRoute(params: Record<string, unknown>): {
    agentId: string;
    sessionKey: string;
  };
  export function buildAgentSessionKey(params: Record<string, unknown>): string;
}

declare module 'openclaw/plugin-sdk/runtime-store' {
  export interface PluginRuntime {
    state: {
      resolveStateDir(): string;
      openKeyedStore<T>(options: Record<string, unknown>): {
        lookup(key: string): Promise<T | undefined>;
        register(key: string, value: T): Promise<void>;
      };
      openChannelIngressQueue<_Payload>(options: { accountId: string }): unknown;
    };
    channel: {
      inbound: {
        buildContext(params: Record<string, unknown>): unknown;
        dispatch(params: Record<string, unknown>): Promise<unknown>;
      };
    };
  }
  export function createPluginRuntimeStore<T>(options: {
    pluginId: string;
    errorMessage: string;
  }): {
    setRuntime(runtime: T): void;
    getRuntime(): T;
  };
}

declare module 'openclaw/plugin-sdk/plugin-entry' {
  export function definePluginEntry(options: {
    id: string;
    name: string;
    description: string;
    register(api: {
      registrationMode: string;
      runtime: import('openclaw/plugin-sdk/runtime-store').PluginRuntime;
      registerChannel(registration: { plugin: unknown }): void;
    }): void;
  }): unknown;
}
