import { HttpMethod } from '@activepieces/pieces-common';
import { createAction, Property } from '@activepieces/pieces-framework';
import { pidgeonAuth } from '../auth';
import { addressList, idempotencyKey, pidgeonRequest } from '../common/client';
import { addressDropdown } from '../common/props';

export const sendEmail = createAction({
  auth: pidgeonAuth,
  name: 'send_email',
  displayName: 'Send Email',
  description: 'Starts a new conversation from one of your addresses. This sends real mail.',
  classification: 'WRITE',
  audience: 'both',
  aiMetadata: {
    description:
      'Sends a new email from a Pidgeon address the key may send from. Use Reply to answer a message instead, so it stays in its thread. A retry of the same step in the same run sends once.',
    idempotent: true,
  },
  props: {
    from: addressDropdown({
      displayName: 'From',
      description: 'The address it is sent from.',
      required: true,
      value: 'email',
    }),
    to: Property.ShortText({
      displayName: 'To',
      description: 'One address, or several separated by commas.',
      required: true,
    }),
    subject: Property.ShortText({ displayName: 'Subject', required: true }),
    text: Property.LongText({
      displayName: 'Text',
      description: 'The plain-text body. It is sent even when there is HTML: some clients read only this.',
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
    const to = addressList(context.propsValue.to);
    if (to.length === 0) throw new Error('Name somebody to send to.');

    const body: Record<string, unknown> = {
      from: context.propsValue.from,
      to,
      subject: context.propsValue.subject,
      text: context.propsValue.text,
      ...copies(context.propsValue),
    };
    if (context.propsValue.html) body['html'] = context.propsValue.html;

    const sent = await pidgeonRequest({
      key: context.auth.secret_text,
      method: HttpMethod.POST,
      path: '/messages',
      body,
      headers: idempotencyKey({ runId: context.run.id, stepName: context.step.name, body }),
    });
    return sent.data;
  },
});

export function copies(props: { cc?: string; bcc?: string }): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const cc = addressList(props.cc);
  const bcc = addressList(props.bcc);
  if (cc.length) out['cc'] = cc;
  if (bcc.length) out['bcc'] = bcc;
  return out;
}
