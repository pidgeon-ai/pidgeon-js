import type {
  IAuthenticateGeneric,
  Icon,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from 'n8n-workflow';

/**
 * A Pidgeon API key, sent as `Authorization: Bearer`.
 *
 * A test key (`pgn_test_…`) works here exactly as a live one does: it is the
 * same header, and the API decides what it may do. Nothing leaves Pidgeon
 * on a test key, which is what a workflow wants while it is being built.
 */
export class PidgeonApi implements ICredentialType {
  name = 'pidgeonApi';

  displayName = 'Pidgeon API';

  icon: Icon = { light: 'file:../icons/pidgeon.svg', dark: 'file:../icons/pidgeon.dark.svg' };

  documentationUrl = 'https://pidgeon.ai/docs/n8n?utm_source=n8n#the-credential';

  properties: INodeProperties[] = [
    {
      displayName: 'API Key',
      name: 'apiKey',
      type: 'string',
      typeOptions: { password: true },
      required: true,
      default: '',
      placeholder: 'pgn_live_… or pgn_test_…',
      description:
        'Make one at pidgeon.ai/app/developers/keys. Give it one address and the least access the workflow needs: read for a trigger, send to reply. One address and one key per workflow.',
    },
    {
      displayName: 'Base URL',
      name: 'baseUrl',
      type: 'hidden',
      default: 'https://pidgeon.ai/api/v1',
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

  // `GET /me` answers for every key, whatever it reaches.
  test: ICredentialTestRequest = {
    request: {
      baseURL: '={{$credentials.baseUrl}}',
      url: '/me',
      method: 'GET',
    },
  };
}
