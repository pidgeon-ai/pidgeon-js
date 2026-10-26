import { HttpMethod } from '@activepieces/pieces-common';
import { createAction, Property } from '@activepieces/pieces-framework';
import { pidgeonAuth } from '../auth';
import { idempotencyKey, pidgeonRequest } from '../common/client';
import { copies } from './send-email';

export const replyToEmail = createAction({
  auth: pidgeonAuth,
  name: 'reply_to_email',
  displayName: 'Reply to Email',
  description: 'Answers a message in its thread, from the address it arrived at. This sends real mail.',
  classification: 'WRITE',
  audience: 'both',
  aiMetadata: {
    description:
      'Replies to one Pidgeon message by its message_id, in the same thread and from the address that received it. The recipient and subject come from the message. A retry of the same step in the same run sends once.',
    idempotent: true,
  },
  props: {
    message_id: Property.ShortText({
      displayName: 'Message ID',
      description: 'The `message_id` from the trigger, a search or Wait for Code.',
      required: true,
    }),
    text: Property.LongText({
      displayName: 'Text',
      description: 'The plain-text body.',
      required: true,
    }),
    html: Property.LongText({
      displayName: 'HTML',
      description: 'An HTML version of the text.',
      required: false,
    }),
    cc: Property.ShortText({ displayName: 'CC', description: 'Addresses separated by commas.', required: false }),
    bcc: Property.ShortText({ displayName: 'BCC', description: 'Addresses separated by commas.', required: false }),
  },
  async run(context) {
    const id = context.propsValue.message_id.trim();
    const body: Record<string, unknown> = { text: context.propsValue.text, ...copies(context.propsValue) };
    if (context.propsValue.html) body['html'] = context.propsValue.html;

    const sent = await pidgeonRequest({
      key: context.auth.secret_text,
      method: HttpMethod.POST,
      path: `/messages/${encodeURIComponent(id)}/reply`,
      body,
      headers: idempotencyKey({ runId: context.run.id, stepName: context.step.name, body: { id, ...body } }),
    });
    return sent.data;
  },
});
