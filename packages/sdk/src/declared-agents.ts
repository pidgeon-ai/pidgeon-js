// Written by scripts/declared-agents.mts from DECLARED_AGENTS (src/lib/checks.ts). Do not edit.

/**
 * The User-Agent tokens of agents that name themselves without signing
 * (ChatGPT-User, Perplexity-User, Claude-User, …). Pidgeon records a request
 * carrying one as `declared`, and checks its address where the vendor
 * publishes its ranges.
 */
export const DECLARED_AGENT_TOKENS: readonly string[] = [
  'ChatGPT-User',
  'OAI-SearchBot',
  'GPTBot',
  'Perplexity-User',
  'PerplexityBot',
  'Claude-User',
  'Claude-SearchBot',
  'ClaudeBot',
  'Claude-Agent',
  'Google-Agent',
  'Google-GeminiNotebook',
  'meta-externalfetcher',
  'meta-externalagent',
  'DuckAssistBot',
  'MistralAI-User',
  'MistralAI-Index',
  'Amzn-User',
  'YouBot',
  'CCBot',
];

/** The declared agent a User-Agent names, as a whole product token, or null. */
export function declaredAgentToken(userAgent: string | null | undefined): string | null {
  const ua = userAgent?.toLowerCase();
  if (!ua) return null;
  for (const token of DECLARED_AGENT_TOKENS) {
    const lower = token.toLowerCase();
    let at = ua.indexOf(lower);
    while (at !== -1) {
      const before = at === 0 ? '' : ua[at - 1]!;
      const after = ua[at + lower.length] ?? '';
      if (!/[a-z0-9-]/.test(before) && !/[a-z0-9-]/.test(after)) return token;
      at = ua.indexOf(lower, at + 1);
    }
  }
  return null;
}
