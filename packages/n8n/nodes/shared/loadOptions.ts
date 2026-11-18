import type { ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';

import { pidgeonRequestAll } from './transport';

/** The inboxes this key reaches, by id. */
export async function getInboxes(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
  const inboxes = await pidgeonRequestAll.call(this, '/v1/email/inboxes', {}, 500);
  return inboxes.map((inbox) => ({
    name: String(inbox.address),
    value: String(inbox.id),
    description: inbox.display_name ? String(inbox.display_name) : undefined,
  }));
}
