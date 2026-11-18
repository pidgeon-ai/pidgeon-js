import type { INodeProperties } from 'n8n-workflow';

/**
 * The fields of every operation. Each operation is one call to Pidgeon's
 * `/v1` API (a reply reads the message first, a wait may call several
 * times). Operations that write to people outside the account say so first,
 * because n8n has no field for it.
 */

const SENDS = 'Writes to people outside your account. ';

const show = (resource: string, operation: string[]) => ({
  show: { resource: [resource], operation },
});

const inboxField = (
  name: string,
  displayOptions: INodeProperties['displayOptions'],
  required = true,
): INodeProperties => ({
  displayName: required ? 'Inbox Name or ID' : 'Inbox Name or ID (Optional)',
  name,
  type: 'options',
  typeOptions: { loadOptionsMethod: 'getInboxes' },
  required,
  default: '',
  displayOptions,
  description:
    'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
});

const idField = (
  displayName: string,
  name: string,
  displayOptions: INodeProperties['displayOptions'],
): INodeProperties => ({
  displayName,
  name,
  type: 'string',
  required: true,
  default: '',
  displayOptions,
});

const bodyField = (displayOptions: INodeProperties['displayOptions']): INodeProperties => ({
  displayName: 'Body',
  name: 'body',
  type: 'options',
  displayOptions,
  options: [
    {
      name: 'Clean',
      value: 'clean',
      description: 'The text with anything hidden or addressed to an AI taken out',
    },
    {
      name: 'Original',
      value: 'original',
      description:
        'Exactly as sent. Can carry hidden instructions: give it to a model only if you have to.',
    },
  ],
  default: 'clean',
});

const returnAllFields = (resource: string, operation: string): INodeProperties[] => [
  {
    displayName: 'Return All',
    name: 'returnAll',
    type: 'boolean',
    displayOptions: show(resource, [operation]),
    default: false,
    description: 'Whether to return all results or only up to a given limit',
  },
  {
    displayName: 'Limit',
    name: 'limit',
    type: 'number',
    displayOptions: { show: { resource: [resource], operation: [operation], returnAll: [false] } },
    typeOptions: { minValue: 1 },
    default: 50,
    description: 'Max number of results to return',
  },
];

const recipientsCollection = (
  displayOptions: INodeProperties['displayOptions'],
  withBcc = true,
): INodeProperties => ({
  displayName: 'Additional Fields',
  name: 'additionalFields',
  type: 'collection',
  placeholder: 'Add Field',
  default: {},
  displayOptions,
  options: [
    {
      displayName: 'CC',
      name: 'cc',
      type: 'string',
      default: '',
      description: 'Addresses, separated by commas',
    },
    ...(withBcc
      ? [
          {
            displayName: 'BCC',
            name: 'bcc',
            type: 'string' as const,
            default: '',
            description: 'Addresses, separated by commas',
          },
        ]
      : []),
    {
      displayName: 'HTML',
      name: 'html',
      type: 'string',
      typeOptions: { rows: 4 },
      default: '',
      description: 'An HTML body beside the text',
    },
    {
      displayName: 'Attachment IDs',
      name: 'attachmentIds',
      type: 'string',
      default: '',
      description: 'Finished uploads of this inbox, separated by commas: up to 20 and 25 MB in all',
    },
  ],
});

export const resourceField: INodeProperties = {
  displayName: 'Resource',
  name: 'resource',
  type: 'options',
  noDataExpression: true,
  options: [
    { name: 'Agent Request', value: 'agentRequest' },
    { name: 'Attachment', value: 'attachment' },
    { name: 'Draft', value: 'draft' },
    { name: 'Inbox', value: 'inbox' },
    { name: 'Message', value: 'message' },
    { name: 'Thread', value: 'thread' },
  ],
  default: 'message',
};

export const operationFields: INodeProperties[] = [
  {
    displayName: 'Operation',
    name: 'operation',
    type: 'options',
    noDataExpression: true,
    displayOptions: { show: { resource: ['agentRequest'] } },
    options: [
      {
        name: 'Verify',
        value: 'verify',
        action: 'Verify an agent request',
        description:
          'Ask Pidgeon who stands behind a request an AI agent made to your site, and how they stand',
      },
    ],
    default: 'verify',
  },
  {
    displayName: 'Operation',
    name: 'operation',
    type: 'options',
    noDataExpression: true,
    displayOptions: { show: { resource: ['attachment'] } },
    options: [
      {
        name: 'Download',
        value: 'download',
        action: 'Download an attachment',
        description: 'Fetch a file of a message as binary data',
      },
    ],
    default: 'download',
  },
  {
    displayName: 'Operation',
    name: 'operation',
    type: 'options',
    noDataExpression: true,
    displayOptions: { show: { resource: ['draft'] } },
    options: [
      {
        name: 'Create',
        value: 'create',
        action: 'Create a draft',
        description: 'Write a message without sending it, for a person or a later step',
      },
      {
        name: 'Send',
        value: 'send',
        action: 'Send a draft',
        description: SENDS + 'Send a draft, now or at a time',
      },
    ],
    default: 'create',
  },
  {
    displayName: 'Operation',
    name: 'operation',
    type: 'options',
    noDataExpression: true,
    displayOptions: { show: { resource: ['inbox'] } },
    options: [
      {
        name: 'Create',
        value: 'create',
        action: 'Create an inbox',
        description: 'Make an inbox, for an agent or for this workflow',
      },
      { name: 'Get', value: 'get', action: 'Get an inbox', description: 'Read one inbox' },
      {
        name: 'Get Many',
        value: 'getAll',
        action: 'Get many inboxes',
        description: 'List the inboxes this key reaches',
      },
    ],
    default: 'getAll',
  },
  {
    displayName: 'Operation',
    name: 'operation',
    type: 'options',
    noDataExpression: true,
    displayOptions: { show: { resource: ['message'] } },
    options: [
      {
        name: 'Get',
        value: 'get',
        action: 'Get a message',
        description: 'Read one message, with its text and attachments',
      },
      {
        name: 'Get Many',
        value: 'getAll',
        action: 'Get many messages',
        description: 'An inbox’s mail, newest first',
      },
      {
        name: 'Reply',
        value: 'reply',
        action: 'Reply to a message',
        description: SENDS + 'Answer a message in its conversation, from the inbox it is in',
      },
      {
        name: 'Search',
        value: 'search',
        action: 'Search messages',
        description: 'Find mail by words in its subject, sender or text',
      },
      {
        name: 'Send',
        value: 'send',
        action: 'Send a message',
        description: SENDS + 'Send from an inbox',
      },
      {
        name: 'Wait',
        value: 'wait',
        action: 'Wait for a message',
        description: 'Wait until mail arrives in an inbox, then answer it',
      },
    ],
    default: 'send',
  },
  {
    displayName: 'Operation',
    name: 'operation',
    type: 'options',
    noDataExpression: true,
    displayOptions: { show: { resource: ['thread'] } },
    options: [
      {
        name: 'Get',
        value: 'get',
        action: 'Get a thread',
        description: 'A conversation and its messages, oldest first',
      },
      {
        name: 'Get Many',
        value: 'getAll',
        action: 'Get many threads',
        description: 'Conversations, newest first',
      },
      {
        name: 'Update',
        value: 'update',
        action: 'Update a thread',
        description: 'File a conversation, or hand it to a person or back to the agent',
      },
    ],
    default: 'get',
  },
];

export const agentRequestFields: INodeProperties[] = [
  {
    displayName: 'Method',
    name: 'method',
    type: 'options',
    displayOptions: show('agentRequest', ['verify']),
    options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map((method) => ({
      name: method,
      value: method,
    })),
    default: 'GET',
    description: 'The method of the request the agent made',
  },
  {
    displayName: 'URL',
    name: 'url',
    type: 'string',
    required: true,
    displayOptions: show('agentRequest', ['verify']),
    default: '',
    placeholder: 'https://shop.example/api/orders',
    description: 'The full URL the agent requested, with its query',
  },
  {
    displayName: 'Headers',
    name: 'headers',
    type: 'json',
    required: true,
    displayOptions: show('agentRequest', ['verify']),
    default: '={{ JSON.stringify($json.headers) }}',
    description:
      'The request’s headers as received, as a JSON object. A Webhook node’s item has them in headers.',
  },
];

export const attachmentFields: INodeProperties[] = [
  idField('Attachment ID', 'attachmentId', show('attachment', ['download'])),
  {
    displayName: 'Put Output File in Field',
    name: 'binaryPropertyName',
    type: 'string',
    required: true,
    displayOptions: show('attachment', ['download']),
    default: 'data',
    hint: 'The name of the output binary field to put the file in',
  },
];

export const draftFields: INodeProperties[] = [
  inboxField('inboxId', show('draft', ['create'])),
  {
    displayName: 'To',
    name: 'to',
    type: 'string',
    required: true,
    displayOptions: show('draft', ['create']),
    default: '',
    description: 'Addresses, separated by commas',
  },
  {
    displayName: 'Subject',
    name: 'subject',
    type: 'string',
    displayOptions: show('draft', ['create']),
    default: '',
  },
  {
    displayName: 'Text',
    name: 'text',
    type: 'string',
    typeOptions: { rows: 4 },
    displayOptions: show('draft', ['create']),
    default: '',
  },
  {
    displayName: 'Ask a Person to Approve',
    name: 'requestApproval',
    type: 'boolean',
    displayOptions: show('draft', ['create']),
    default: false,
    description:
      'Whether to put the draft before the account’s people, who send or reject it in Pidgeon',
  },
  {
    displayName: 'Reply To Message ID',
    name: 'replyTo',
    type: 'string',
    displayOptions: show('draft', ['create']),
    default: '',
    description: 'A message of this inbox the draft answers; it joins that conversation',
  },
  recipientsCollection(show('draft', ['create'])),
  idField('Draft ID', 'draftId', show('draft', ['send'])),
  {
    displayName: 'Send At',
    name: 'sendAt',
    type: 'dateTime',
    displayOptions: show('draft', ['send']),
    default: '',
    description: 'When to send it; now when left empty',
  },
];

export const inboxFields: INodeProperties[] = [
  {
    displayName: 'Name',
    name: 'name',
    type: 'string',
    required: true,
    displayOptions: show('inbox', ['create']),
    default: '',
    placeholder: 'bookings',
    description: 'The part before the @: up to 64 characters, each a-z, 0-9 or one of . _ + -.',
  },
  {
    displayName: 'Additional Fields',
    name: 'additionalFields',
    type: 'collection',
    placeholder: 'Add Field',
    default: {},
    displayOptions: show('inbox', ['create']),
    options: [
      {
        displayName: 'Agent ID',
        name: 'agentId',
        type: 'string',
        default: '',
        description:
          'A Pidgeon agent to give the inbox to: its mail then carries the agent’s signed declaration',
      },
      {
        displayName: 'Display Name',
        name: 'displayName',
        type: 'string',
        default: '',
        description: 'Shown on its mail',
      },
      {
        displayName: 'Domain',
        name: 'domain',
        type: 'string',
        default: '',
        description: 'One of your domains with mail on; pidgeon.email when left empty',
      },
      {
        displayName: 'Kind',
        name: 'kind',
        type: 'options',
        options: [
          { name: 'Agent', value: 'agent', description: 'An inbox that sends and receives' },
          {
            name: 'Events',
            value: 'events',
            description: 'Receives only, each message an event',
          },
        ],
        default: 'agent',
      },
      {
        displayName: 'Pod ID',
        name: 'podId',
        type: 'string',
        default: '',
        description: 'The pod to make it in; the key’s own when left empty',
      },
    ],
  },
  inboxField('inboxId', show('inbox', ['get'])),
  ...returnAllFields('inbox', 'getAll'),
];

export const messageFields: INodeProperties[] = [
  inboxField('inboxId', show('message', ['send', 'getAll', 'wait'])),
  inboxField('searchInboxId', show('message', ['search']), false),
  idField('Message ID', 'messageId', show('message', ['get', 'reply'])),
  {
    displayName: 'To',
    name: 'to',
    type: 'string',
    required: true,
    displayOptions: show('message', ['send']),
    default: '',
    description: 'Addresses, separated by commas',
  },
  {
    displayName: 'Subject',
    name: 'subject',
    type: 'string',
    displayOptions: show('message', ['send']),
    default: '',
  },
  {
    displayName: 'Text',
    name: 'text',
    type: 'string',
    required: true,
    typeOptions: { rows: 4 },
    displayOptions: show('message', ['send', 'reply']),
    default: '',
  },
  recipientsCollection(show('message', ['send'])),
  recipientsCollection(show('message', ['reply']), false),
  {
    displayName: 'Query',
    name: 'query',
    type: 'string',
    required: true,
    displayOptions: show('message', ['search']),
    default: '',
    description: 'Words to find in the subject, the sender or the text',
  },
  {
    displayName: 'Limit',
    name: 'limit',
    type: 'number',
    displayOptions: show('message', ['search']),
    typeOptions: { minValue: 1 },
    default: 50,
    description: 'Max number of results to return',
  },
  ...returnAllFields('message', 'getAll'),
  {
    displayName: 'Timeout (Seconds)',
    name: 'timeout',
    type: 'number',
    displayOptions: show('message', ['wait']),
    typeOptions: { minValue: 1, maxValue: 3600 },
    default: 300,
    description: 'How long to wait before answering with no message',
  },
  {
    displayName: 'Since',
    name: 'since',
    type: 'string',
    displayOptions: show('message', ['wait']),
    default: '',
    description:
      'Mail newer than this time or message ID. When left empty, mail that arrives after the node starts.',
  },
  bodyField(show('message', ['get', 'getAll', 'search', 'wait'])),
];

export const threadFields: INodeProperties[] = [
  idField('Thread ID', 'threadId', show('thread', ['get', 'update'])),
  bodyField(show('thread', ['get'])),
  {
    displayName: 'Filters',
    name: 'filters',
    type: 'collection',
    placeholder: 'Add Filter',
    default: {},
    displayOptions: show('thread', ['getAll']),
    options: [
      {
        displayName: 'Folder',
        name: 'folder',
        type: 'options',
        options: [
          { name: 'Archive', value: 'archive' },
          { name: 'Inbox', value: 'inbox' },
          { name: 'Spam', value: 'spam' },
          { name: 'Trash', value: 'trash' },
        ],
        default: 'inbox',
      },
      {
        displayName: 'Inbox Name or ID',
        name: 'inboxId',
        type: 'options',
        typeOptions: { loadOptionsMethod: 'getInboxes' },
        default: '',
        description:
          'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
      },
      {
        displayName: 'Starred Only',
        name: 'starred',
        type: 'boolean',
        default: false,
        description: 'Whether to return only starred conversations',
      },
      {
        displayName: 'Status',
        name: 'status',
        type: 'options',
        options: [
          { name: 'Human Review', value: 'human_review' },
          { name: 'Open', value: 'open' },
          { name: 'Resolved', value: 'resolved' },
          { name: 'Waiting', value: 'waiting' },
        ],
        default: 'open',
      },
    ],
  },
  ...returnAllFields('thread', 'getAll'),
  {
    displayName: 'Update Fields',
    name: 'updateFields',
    type: 'collection',
    placeholder: 'Add Field',
    default: {},
    displayOptions: show('thread', ['update']),
    options: [
      {
        displayName: 'Folder',
        name: 'folder',
        type: 'options',
        options: [
          { name: 'Archive', value: 'archive' },
          { name: 'Inbox', value: 'inbox' },
          { name: 'Spam', value: 'spam' },
          { name: 'Trash', value: 'trash' },
        ],
        default: 'archive',
      },
      {
        displayName: 'Owner',
        name: 'ownerType',
        type: 'options',
        options: [
          { name: 'Agent', value: 'agent', description: 'Give it back to the agent' },
          { name: 'Person', value: 'human', description: 'Hand it to the account’s people' },
        ],
        default: 'human',
      },
      {
        displayName: 'Starred',
        name: 'starred',
        type: 'boolean',
        default: true,
        description: 'Whether the conversation is starred',
      },
      {
        displayName: 'Status',
        name: 'status',
        type: 'options',
        options: [
          { name: 'Human Review', value: 'human_review' },
          { name: 'Open', value: 'open' },
          { name: 'Resolved', value: 'resolved' },
          { name: 'Waiting', value: 'waiting' },
        ],
        default: 'human_review',
      },
    ],
  },
];
