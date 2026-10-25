import type { ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';

import { pidgeonRequestAll } from './transport';

/** The addresses this key reaches, by id. */
export async function getAddresses(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
  const addresses = await pidgeonRequestAll.call(this, '/identities', { limit: 100 });
  return addresses.map((address) => ({
    name: String(address.email),
    value: String(address.id),
    description: address.display_name ? String(address.display_name) : undefined,
  }));
}

/** The same addresses, by email, for the fields that take one. */
export async function getAddressEmails(
  this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
  const addresses = await pidgeonRequestAll.call(this, '/identities', { limit: 100 });
  return addresses.map((address) => ({
    name: String(address.email),
    value: String(address.email),
  }));
}

/** The people in the account, for handing a thread to one of them. */
export async function getMembers(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
  const members = await pidgeonRequestAll.call(this, '/workspace/members');
  return [
    { name: 'Nobody in Particular', value: '' },
    // `email` is null unless the key administers the account.
    ...members.map((member) => ({
      name:
        [member.name, member.email ? `(${String(member.email)})` : null]
          .filter(Boolean)
          .join(' ') || String(member.id),
      value: String(member.id),
    })),
  ];
}
