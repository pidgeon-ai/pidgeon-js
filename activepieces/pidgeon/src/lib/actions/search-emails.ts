import { HttpMethod } from '@activepieces/pieces-common';
import { createAction, Property } from '@activepieces/pieces-framework';
import { pidgeonAuth } from '../auth';
import { pidgeonRequest } from '../common/client';
import { addressDropdown } from '../common/props';

export const searchEmails = createAction({
  auth: pidgeonAuth,
  name: 'search_emails',
  displayName: 'Search Emails',
  description: 'Finds messages by words, sender or folder.',
  classification: 'READ',
  audience: 'both',
  aiMetadata: {
    description:
      'Searches the mail the key reaches, newest first. Returns message summaries with message_id and thread_id; read one in full with the trigger or Wait for Code. Leave the words empty to list the newest mail.',
    idempotent: true,
  },
  props: {
    q: Property.ShortText({
      displayName: 'Search Words',
      description: 'Words in the subject or the text. Leave empty to list the newest mail.',
      required: false,
    }),
    identity_id: addressDropdown({
      displayName: 'Address',
      description: 'Only mail at this address.',
      required: false,
      value: 'id',
    }),
    from: Property.ShortText({ displayName: 'From', required: false }),
    folder: Property.StaticDropdown({
      displayName: 'Folder',
      required: false,
      options: {
        disabled: false,
        options: [
          { label: 'Inbox', value: 'inbox' },
          { label: 'Sent', value: 'sent' },
          { label: 'Archive', value: 'archive' },
          { label: 'Spam', value: 'spam' },
          { label: 'Starred', value: 'starred' },
          { label: 'Trash', value: 'trash' },
        ],
      },
    }),
    limit: Property.Number({
      displayName: 'Limit',
      description: 'At most this many, up to 100.',
      required: false,
      defaultValue: 20,
    }),
  },
  async run(context) {
    const found = await pidgeonRequest<unknown[]>({
      key: context.auth.secret_text,
      method: HttpMethod.GET,
      path: '/messages/search',
      query: {
        q: context.propsValue.q,
        identity_id: context.propsValue.identity_id,
        from: context.propsValue.from,
        in: context.propsValue.folder,
        limit: Math.min(Math.max(Math.round(context.propsValue.limit ?? 20), 1), 100),
      },
    });
    return { messages: found.data ?? [], has_more: found.has_more ?? false };
  },
});
