import { HttpMethod } from '@activepieces/pieces-common';
import { createAction, Property } from '@activepieces/pieces-framework';
import { pidgeonAuth } from '../auth';
import { pidgeonRequest } from '../common/client';
import { flatMessage } from '../common/mapping';
import { addressDropdown, bodyChoice } from '../common/props';

export const waitForCode = createAction({
  auth: pidgeonAuth,
  name: 'wait_for_code',
  displayName: 'Wait for Code',
  description: 'Waits for the next email at an address, and reads the verification code in it.',
  classification: 'READ',
  audience: 'both',
  aiMetadata: {
    description:
      'Holds open until the next email with a verification code arrives at a Pidgeon address, up to the timeout, and returns the code as `code` with the message. Nothing arriving is not an error: `timed_out` is true. Start it before the sign-up that sends the code, or pass After.',
    idempotent: true,
  },
  props: {
    identity_id: addressDropdown({
      displayName: 'Address',
      description: 'The address the code is sent to.',
      required: true,
      value: 'id',
    }),
    timeout: Property.Number({
      displayName: 'Wait For (Seconds)',
      description: 'How long to wait before giving up, up to 280.',
      required: true,
      defaultValue: 120,
    }),
    from: Property.ShortText({
      displayName: 'From',
      description: 'Only mail from this sender, such as `no-reply@github.com`. It must pass DMARC.',
      required: false,
    }),
    subject_contains: Property.ShortText({
      displayName: 'Subject Contains',
      required: false,
    }),
    after: Property.ShortText({
      displayName: 'After',
      description:
        'Only mail that arrived after this: `now`, or the `cursor` an earlier Wait for Code returned. Empty, a code that arrived just before the step started still counts.',
      required: false,
    }),
    any_mail: Property.Checkbox({
      displayName: 'Any Mail',
      description: 'Whether to stop at the next email even when Pidgeon found no code in it.',
      required: false,
      defaultValue: false,
    }),
    body: bodyChoice,
  },
  async run(context) {
    const timeout = Math.min(Math.max(Math.round(context.propsValue.timeout ?? 120), 1), 280);
    const awaited = await pidgeonRequest<{
      message: Record<string, unknown> | null;
      timed_out?: boolean;
      cursor?: string | null;
      held_back?: unknown;
    }>({
      key: context.auth.secret_text,
      method: HttpMethod.GET,
      path: '/messages/await',
      query: {
        identity_id: context.propsValue.identity_id,
        timeout,
        has_code: context.propsValue.any_mail ? undefined : 'true',
        from: context.propsValue.from,
        subject_contains: context.propsValue.subject_contains,
        after: context.propsValue.after,
        body: context.propsValue.body,
      },
      // Pidgeon holds the request open until mail arrives, so it outlives the wait.
      timeout: timeout + 30,
    });

    const message = awaited.data?.message ?? null;
    const item = message ? flatMessage({ message }) : {};
    return {
      code: (item['codes'] as string[] | undefined)?.[0] ?? null,
      ...item,
      timed_out: awaited.data?.timed_out ?? !message,
      cursor: awaited.data?.cursor ?? null,
      held_back: awaited.data?.held_back ?? null,
    };
  },
});
