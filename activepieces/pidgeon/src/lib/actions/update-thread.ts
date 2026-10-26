import { HttpMethod } from '@activepieces/pieces-common';
import { createAction, Property } from '@activepieces/pieces-framework';
import { pidgeonAuth } from '../auth';
import { pidgeonRequest } from '../common/client';

export const updateThread = createAction({
  auth: pidgeonAuth,
  name: 'update_thread',
  displayName: 'Update Thread',
  description: 'Hands a thread to a person or back to the agent, or changes its status.',
  classification: 'WRITE',
  audience: 'both',
  aiMetadata: {
    description:
      'Changes a Pidgeon thread: who owns it (a person, so the agent leaves it alone, or the agent) and its status (open, waiting, resolved, human review). Fields left empty are not changed.',
    idempotent: true,
  },
  props: {
    thread_id: Property.ShortText({
      displayName: 'Thread ID',
      description: 'The `thread_id` from the trigger or a message.',
      required: true,
    }),
    owner: Property.StaticDropdown({
      displayName: 'Owner',
      description: 'A person: the thread is theirs to answer, and the agent leaves it alone.',
      required: false,
      options: {
        disabled: false,
        options: [
          { label: 'Hand to a person', value: 'human' },
          { label: 'Give back to the agent', value: 'agent' },
        ],
      },
    }),
    assignee_id: Property.ShortText({
      displayName: 'Assignee ID',
      description: 'The member to hand it to, when the owner is a person. Leave empty for nobody in particular.',
      required: false,
    }),
    status: Property.StaticDropdown({
      displayName: 'Status',
      required: false,
      options: {
        disabled: false,
        options: [
          { label: 'Open', value: 'open' },
          { label: 'Waiting', value: 'waiting' },
          { label: 'Resolved', value: 'resolved' },
          { label: 'Human review', value: 'human_review' },
        ],
      },
    }),
    reason: Property.ShortText({
      displayName: 'Reason',
      description: 'Why, in a sentence. The person it goes to sees it.',
      required: false,
    }),
  },
  async run(context) {
    const { thread_id, owner, assignee_id, status, reason } = context.propsValue;
    const body: Record<string, unknown> = {};
    if (owner) body['owner_type'] = owner;
    if (owner === 'human') body['assignee_id'] = assignee_id?.trim() || null;
    if (status) body['status'] = status;
    if (reason?.trim()) body['reason'] = reason.trim();
    if (Object.keys(body).length === 0) throw new Error('Choose an owner or a status to change.');

    const updated = await pidgeonRequest({
      key: context.auth.secret_text,
      method: HttpMethod.PATCH,
      path: `/threads/${encodeURIComponent(thread_id.trim())}`,
      body,
    });
    return updated.data;
  },
});
