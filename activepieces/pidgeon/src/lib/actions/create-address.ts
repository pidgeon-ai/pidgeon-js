import { HttpMethod } from '@activepieces/pieces-common';
import { createAction, Property } from '@activepieces/pieces-framework';
import { pidgeonAuth } from '../auth';
import { idempotencyKey, pidgeonRequest } from '../common/client';

export const createAddress = createAction({
  auth: pidgeonAuth,
  name: 'create_address',
  displayName: 'Create Address',
  description: 'Creates an email address for a flow or an agent.',
  classification: 'WRITE',
  audience: 'both',
  aiMetadata: {
    description:
      'Creates a new Pidgeon email address. Needs a key with admin access; a test key cannot create addresses. Returns the address with its id, which other Pidgeon steps take.',
    idempotent: false,
  },
  props: {
    address: Property.ShortText({
      displayName: 'Address',
      description:
        'The whole address, such as `quotes@acme.pidgeon.email`, on `pidgeon.email` or a domain you have connected.',
      required: true,
    }),
    display_name: Property.ShortText({
      displayName: 'Display Name',
      description: 'The name a recipient sees beside the address.',
      required: false,
    }),
    type: Property.StaticDropdown({
      displayName: 'Type',
      description: 'What the address is for. It does not change what the address can do.',
      required: true,
      defaultValue: 'workflow',
      options: {
        disabled: false,
        options: [
          { label: 'Workflow: a flow reads what arrives', value: 'workflow' },
          { label: 'Agent: an AI agent answers it', value: 'agent' },
          { label: 'Application', value: 'application' },
          { label: 'Team', value: 'team' },
        ],
      },
    }),
    send_policy: Property.StaticDropdown({
      displayName: 'Who It May Write To',
      description:
        'Only people who wrote first: it can answer mail, but cannot start a conversation with a stranger.',
      required: true,
      defaultValue: 'reply_only',
      options: {
        disabled: false,
        options: [
          { label: 'Only people who wrote first', value: 'reply_only' },
          { label: 'Anybody', value: 'open' },
        ],
      },
    }),
    inbox: Property.Checkbox({
      displayName: 'Keep Mail',
      description:
        'Whether what arrives is stored, so a person can open it in Pidgeon. Off, mail is delivered to the flow and not kept.',
      required: false,
      defaultValue: true,
    }),
  },
  async run(context) {
    const body: Record<string, unknown> = {
      address: context.propsValue.address.trim(),
      type: context.propsValue.type,
      send_policy: context.propsValue.send_policy,
      inbox: context.propsValue.inbox ?? true,
    };
    if (context.propsValue.display_name) body['display_name'] = context.propsValue.display_name;

    const created = await pidgeonRequest({
      key: context.auth.secret_text,
      method: HttpMethod.POST,
      path: '/identities',
      body,
      headers: idempotencyKey({ runId: context.run.id, stepName: context.step.name, body }),
    });
    return created.data;
  },
});
