import { HttpMethod } from '@activepieces/pieces-common';
import { PieceAuth } from '@activepieces/pieces-framework';
import { pidgeonRequest } from './common/client';

export const pidgeonAuth = PieceAuth.SecretText({
  displayName: 'API Key',
  required: true,
  description: `Make a key at **https://pidgeon.ai/app/developers/keys** and paste it here.

Give a flow one address and a key with the least access it needs: **Read only** for a trigger, **Read and send** to reply or send, **Full access** to create addresses. Whatever the key reaches, the flow can reach.

A test key (\`pgn_test_…\`) works the same way, and nothing it sends leaves Pidgeon. Build the flow on one, then switch to a live key.`,
  validate: async ({ auth }) => {
    try {
      await pidgeonRequest({ key: auth, method: HttpMethod.GET, path: '/me' });
      return { valid: true };
    } catch (error) {
      return { valid: false, error: (error as Error).message };
    }
  },
});
