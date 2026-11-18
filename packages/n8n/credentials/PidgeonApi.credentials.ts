import type {
  IAuthenticateGeneric,
  Icon,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from 'n8n-workflow';

/**
 * A Pidgeon API key, sent as `Authorization: Bearer`. The API decides what
 * it may do: its access (`read`, `draft`, `send`, `admin`) and, for a pod's
 * key, which pod. A test key (`pgn_test_…`) works the same, and nothing it
 * sends leaves Pidgeon.
 */
export class PidgeonApi implements ICredentialType {
  name = 'pidgeonApi';

  displayName = 'Pidgeon API';

  icon: Icon = { light: 'file:../icons/pidgeon.svg', dark: 'file:../icons/pidgeon.dark.svg' };

  documentationUrl = 'https://pidgeon.ai/docs/api-keys';

  properties: INodeProperties[] = [
    {
      displayName: 'API Key',
      name: 'apiKey',
      type: 'string',
      typeOptions: { password: true },
      required: true,
      default: '',
      placeholder: 'pgn_…',
      description:
        'Make one at pidgeon.ai/keys with the least access the workflow needs: read to read and wait for mail, draft to save drafts, send to send and reply. The trigger makes its own webhook, which needs an admin key of the whole account.',
    },
    {
      displayName: 'Base URL',
      name: 'baseUrl',
      type: 'hidden',
      default: 'https://pidgeon.ai',
    },
  ];

  authenticate: IAuthenticateGeneric = {
    type: 'generic',
    properties: {
      headers: {
        Authorization: '=Bearer {{$credentials.apiKey}}',
      },
    },
  };

  // Every key may list the inboxes it reaches, whatever its access.
  test: ICredentialTestRequest = {
    request: {
      baseURL: '={{$credentials.baseUrl}}',
      url: '/v1/email/inboxes',
      qs: { limit: 1 },
      method: 'GET',
    },
  };
}
