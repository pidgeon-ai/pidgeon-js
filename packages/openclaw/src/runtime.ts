import { createPluginRuntimeStore, type PluginRuntime } from 'openclaw/plugin-sdk/runtime-store';

/** The host runtime, set once when OpenClaw registers the plugin. */
export const { setRuntime, getRuntime } = createPluginRuntimeStore<PluginRuntime>({
  pluginId: 'pidgeon',
  errorMessage: 'The Pidgeon channel is not registered with OpenClaw yet.',
});
