import { createCustomApiCallAction } from '@activepieces/pieces-common';
import { createPiece, PieceCategory } from '@activepieces/pieces-framework';
import { createAddress } from './lib/actions/create-address';
import { replyToEmail } from './lib/actions/reply';
import { searchEmails } from './lib/actions/search-emails';
import { sendEmail } from './lib/actions/send-email';
import { updateThread } from './lib/actions/update-thread';
import { waitForCode } from './lib/actions/wait-for-code';
import { pidgeonAuth } from './lib/auth';
import { PIDGEON_API } from './lib/common/client';
import { emailReceived } from './lib/triggers/email-received';

export { pidgeonAuth };

export const pidgeon = createPiece({
  displayName: 'Pidgeon',
  description:
    'Email inboxes for AI agents. Give a flow its own address: mail that arrives starts it, and it replies, hands threads to people and waits for verification codes.',
  minimumSupportedRelease: '0.36.1',
  logoUrl: 'https://pidgeon.ai/icon.png',
  authors: ['pidgeon-ai'],
  categories: [PieceCategory.COMMUNICATION, PieceCategory.ARTIFICIAL_INTELLIGENCE],
  auth: pidgeonAuth,
  actions: [
    createAddress,
    sendEmail,
    replyToEmail,
    updateThread,
    waitForCode,
    searchEmails,
    createCustomApiCallAction({
      baseUrl: () => PIDGEON_API,
      auth: pidgeonAuth,
      authMapping: async (auth) => ({
        Authorization: `Bearer ${auth.secret_text}`,
      }),
    }),
  ],
  triggers: [emailReceived],
});
