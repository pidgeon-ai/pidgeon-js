/**
 * `@pidgeon-ai/openclaw`: email for OpenClaw.
 *
 * Mail to an agent's Pidgeon address starts or continues an OpenClaw
 * conversation, one per email thread, and the agent's answer goes back as a
 * reply in that thread. Install with `openclaw plugins install
 * @pidgeon-ai/openclaw`; the setup is at https://pidgeon.ai/docs/openclaw.
 */
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';

import { pidgeonPlugin } from './channel.js';
import { setRuntime } from './runtime.js';

export default definePluginEntry({
  id: 'pidgeon',
  name: 'Pidgeon',
  description:
    "Email for OpenClaw: mail to your agent's Pidgeon address starts or continues a conversation, and its reply goes back in the thread.",
  register(api) {
    if (api.registrationMode === 'tool-discovery') return;
    setRuntime(api.runtime);
    api.registerChannel({ plugin: pidgeonPlugin });
  },
});
