import { HttpMethod } from '@activepieces/pieces-common';
import { Property } from '@activepieces/pieces-framework';
import { pidgeonAuth } from '../auth';
import { pidgeonRequest } from './client';

interface Address {
  id: string;
  email: string;
  display_name?: string | null;
}

/** The addresses this key reaches. */
async function addresses(key: string): Promise<Address[]> {
  const found: Address[] = [];
  let cursor: string | null | undefined;
  do {
    const page = await pidgeonRequest<Address[]>({
      key,
      method: HttpMethod.GET,
      path: '/identities',
      query: { limit: 100, cursor },
    });
    found.push(...(page.data ?? []));
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor && found.length < 1000);
  return found;
}

/** An address picker, by id or by email. */
export function addressDropdown(params: {
  displayName: string;
  description: string;
  required: boolean;
  value: 'id' | 'email';
}) {
  return Property.Dropdown({
    auth: pidgeonAuth,
    displayName: params.displayName,
    description: params.description,
    required: params.required,
    refreshers: [],
    options: async ({ auth }) => {
      if (!auth) {
        return { disabled: true, options: [], placeholder: 'Connect your Pidgeon account first.' };
      }
      try {
        const found = await addresses(auth.secret_text);
        if (found.length === 0) {
          return { disabled: true, options: [], placeholder: 'This key reaches no address yet.' };
        }
        return {
          disabled: false,
          options: found.map((address) => ({
            label: address.display_name ? `${address.display_name} <${address.email}>` : address.email,
            value: params.value === 'id' ? address.id : address.email,
          })),
        };
      } catch (error) {
        return { disabled: true, options: [], placeholder: (error as Error).message };
      }
    },
  });
}

export const bodyChoice = Property.StaticDropdown({
  displayName: 'Body',
  description:
    'Clean is the text with anything hidden or addressed to an AI taken out. Original is exactly as sent, and can carry hidden instructions: give it to a model only if you have to.',
  required: true,
  defaultValue: 'clean',
  options: {
    disabled: false,
    options: [
      { label: 'Clean', value: 'clean' },
      { label: 'Original', value: 'original' },
    ],
  },
});
