import type { INodeProperties } from 'n8n-workflow';

/**
 * The fields of every operation.
 *
 * The set is small on purpose (`docs/prd/n8n.md` §8): what a workflow that
 * answers mail needs, and nothing it would have to be talked out of. Each
 * operation is one endpoint of the published API, which a test holds to.
 *
 * The operations that write to people outside the account say so in their
 * first words, because n8n has no field for it.
 */

const SENDS = 'Writes to people outside your account. ';

const show = (resource: string, operation: string[]) => ({
  show: { resource: [resource], operation },
});

const addressField = (
  name: string,
  displayOptions: INodeProperties['displayOptions'],
  method: 'getAddresses' | 'getAddressEmails' = 'getAddresses',
): INodeProperties => ({
  displayName: 'Address Name or ID',
  name,
  type: 'options',
  typeOptions: { loadOptionsMethod: method },
  required: true,
  default: '',
  displayOptions,
  description:
    'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
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
        'Exactly as sent. Can carry hidden instructions; give it to a model only if you have to.',
    },
  ],
  default: 'clean',
});

export const resourceField: INodeProperties = {
  displayName: 'Resource',
  name: 'resource',
  type: 'options',
  noDataExpression: true,
  options: [
    { name: 'Address', value: 'address' },
    { name: 'Attachment', value: 'attachment' },
    { name: 'Draft', value: 'draft' },
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
    displayOptions: { show: { resource: ['address'] } },
    options: [
      {
        name: 'Create',
        value: 'create',
        action: 'Create an address',
        description: 'Create an address for this workflow or agent',
      },
      {
        name: 'Get Many',
        value: 'getAll',
        action: 'Get many addresses',
        description: 'List the addresses this key reaches',
      },
    ],
    default: 'create',
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
        description: 'Read one message, with its text, codes and links',
      },
      {
        name: 'Reply',
        value: 'reply',
        action: 'Reply to a message',
        description: SENDS + 'Answer a message in its thread',
      },
      {
        name: 'Search',
        value: 'search',
        action: 'Search messages',
        description: 'Find messages by words, sender or folder',
      },
      {
        name: 'Send',
        value: 'send',
        action: 'Send a message',
        description: SENDS + 'Start a new conversation',
      },
      {
        name: 'Wait for a Code',
        value: 'awaitCode',
        action: 'Wait for a verification code',
        description:
          'Wait until mail with a verification code or link arrives, and return the code',
      },
    ],
    default: 'reply',
  },
  {
    displayName: 'Operation',
    name: 'operation',
    type: 'options',
    noDataExpression: true,
    displayOptions: { show: { resource: ['draft'] } },
    options: [
      {
        name: 'Save',
        value: 'create',
        action: 'Save a draft',
        description: 'Save a draft for a person to read, edit and send',
      },
      {
        name: 'Send',
        value: 'send',
        action: 'Send a draft',
        description: SENDS + 'Send a saved draft, once a person has approved it',
      },
    ],
    default: 'create',
  },
  {
    displayName: 'Operation',
    name: 'operation',
    type: 'options',
    noDataExpression: true,
    displayOptions: { show: { resource: ['thread'] } },
    options: [
      {
        name: 'Hand to a Person',
        value: 'handToPerson',
        action: 'Hand a thread to a person',
        description: 'Mark the thread as a person’s to answer, so the agent leaves it alone',
      },
      {
        name: 'Take Back',
        value: 'takeBack',
        action: 'Take a thread back',
        description: 'Give the thread back to the agent',
      },
    ],
    default: 'handToPerson',
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
        description: 'Download an attachment as binary data',
      },
    ],
    default: 'download',
  },
];

export const addressFields: INodeProperties[] = [
  {
    displayName: 'Address',
    name: 'newAddress',
    type: 'string',
    placeholder: 'quotes@yourcompany.pidgeon.email',
    required: true,
    default: '',
    displayOptions: show('address', ['create']),
    description:
      'The whole address. Use your account’s pidgeon.email subdomain, or a domain you have connected.',
  },
  {
    displayName: 'Type',
    name: 'type',
    type: 'options',
    displayOptions: show('address', ['create']),
    options: [
      { name: 'Agent', value: 'agent', description: 'An AI agent answers it' },
      {
        name: 'Workflow',
        value: 'workflow',
        description: 'A workflow reads what arrives; no person opens it',
      },
      { name: 'Application', value: 'application' },
      { name: 'Team', value: 'team' },
    ],
    default: 'agent',
  },
  {
    displayName: 'Keep Mail',
    name: 'inbox',
    type: 'boolean',
    displayOptions: show('address', ['create']),
    default: true,
    description:
      'Whether mail to it is stored, so it can be read, searched and its attachments downloaded. Without an inbox, mail only becomes an event.',
  },
  {
    displayName: 'Who It May Write To',
    name: 'sendPolicy',
    type: 'options',
    displayOptions: show('address', ['create']),
    options: [
      {
        name: 'Only People Who Wrote First',
        value: 'reply_only',
        description: 'It can answer mail but cannot start a conversation with a stranger',
      },
      { name: 'Anybody', value: 'open' },
    ],
    default: 'reply_only',
  },
  {
    displayName: 'Additional Fields',
    name: 'additionalFields',
    type: 'collection',
    placeholder: 'Add Field',
    default: {},
    displayOptions: show('address', ['create']),
    options: [
      {
        displayName: 'Display Name',
        name: 'display_name',
        type: 'string',
        default: '',
        description: 'The name a recipient sees beside the address',
      },
      {
        displayName: 'Pod ID',
        name: 'pod_id',
        type: 'string',
        default: '',
        description:
          'The pod it belongs to. Each client in its own pod keeps one client’s sending reputation apart from another’s.',
      },
    ],
  },
  {
    displayName: 'Return All',
    name: 'returnAll',
    type: 'boolean',
    displayOptions: show('address', ['getAll']),
    default: false,
    description: 'Whether to return all results or only up to a given limit',
  },
  {
    displayName: 'Limit',
    name: 'limit',
    type: 'number',
    displayOptions: { show: { resource: ['address'], operation: ['getAll'], returnAll: [false] } },
    typeOptions: { minValue: 1 },
    default: 50,
    description: 'Max number of results to return',
  },
];

export const messageFields: INodeProperties[] = [
  {
    displayName: 'Message ID',
    name: 'messageId',
    type: 'string',
    required: true,
    default: '',
    displayOptions: show('message', ['get', 'reply']),
    description: 'The message_id from the trigger or a search',
  },
  bodyField(show('message', ['get', 'search', 'awaitCode'])),

  // Send
  addressField('from', show('message', ['send']), 'getAddressEmails'),
  {
    displayName: 'To',
    name: 'to',
    type: 'string',
    required: true,
    default: '',
    placeholder: 'priya@supplier.de',
    displayOptions: show('message', ['send']),
    description: 'One address, or several separated by commas',
  },
  {
    displayName: 'Subject',
    name: 'subject',
    type: 'string',
    default: '',
    displayOptions: show('message', ['send']),
  },
  {
    displayName: 'Text',
    name: 'text',
    type: 'string',
    typeOptions: { rows: 6 },
    required: true,
    default: '',
    displayOptions: show('message', ['send', 'reply']),
  },
  {
    displayName: 'Additional Fields',
    name: 'additionalFields',
    type: 'collection',
    placeholder: 'Add Field',
    default: {},
    displayOptions: show('message', ['send', 'reply']),
    options: [
      {
        displayName: 'BCC',
        name: 'bcc',
        type: 'string',
        default: '',
        description: 'Addresses separated by commas',
      },
      {
        displayName: 'CC',
        name: 'cc',
        type: 'string',
        default: '',
        description: 'Addresses separated by commas',
      },
      {
        displayName: 'HTML',
        name: 'html',
        type: 'string',
        typeOptions: { rows: 6 },
        default: '',
        description: 'An HTML version of the text. The text is still sent beside it.',
      },
    ],
  },

  // Search
  {
    displayName: 'Search Words',
    name: 'q',
    type: 'string',
    default: '',
    displayOptions: show('message', ['search']),
    description: 'Words in the subject or the text. Leave empty to list the newest mail.',
  },
  {
    displayName: 'Limit',
    name: 'limit',
    type: 'number',
    displayOptions: show('message', ['search']),
    typeOptions: { minValue: 1, maxValue: 100 },
    default: 50,
    description: 'Max number of results to return',
  },
  {
    displayName: 'Filters',
    name: 'filters',
    type: 'collection',
    placeholder: 'Add Filter',
    default: {},
    displayOptions: show('message', ['search']),
    options: [
      {
        displayName: 'Address Name or ID',
        name: 'identity_id',
        type: 'options',
        typeOptions: { loadOptionsMethod: 'getAddresses' },
        default: '',
        description:
          'Only mail at this address. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
      },
      {
        displayName: 'Folder',
        name: 'in',
        type: 'options',
        options: [
          { name: 'Archive', value: 'archive' },
          { name: 'Drafts', value: 'drafts' },
          { name: 'Inbox', value: 'inbox' },
          { name: 'Sent', value: 'sent' },
          { name: 'Spam', value: 'spam' },
          { name: 'Starred', value: 'starred' },
          { name: 'Trash', value: 'trash' },
        ],
        default: 'inbox',
      },
      {
        displayName: 'From',
        name: 'from',
        type: 'string',
        default: '',
      },
      {
        displayName: 'To',
        name: 'to',
        type: 'string',
        default: '',
      },
    ],
  },

  // Wait for a code
  addressField('identityId', show('message', ['awaitCode'])),
  {
    displayName: 'Wait For',
    name: 'timeout',
    type: 'number',
    typeOptions: { minValue: 1, maxValue: 280 },
    default: 60,
    displayOptions: show('message', ['awaitCode']),
    description:
      'Seconds to wait before giving up. Nothing arriving is not an error: the item says timed_out.',
  },
  {
    displayName: 'Options',
    name: 'awaitOptions',
    type: 'collection',
    placeholder: 'Add Option',
    default: {},
    displayOptions: show('message', ['awaitCode']),
    options: [
      {
        displayName: 'After',
        name: 'after',
        type: 'string',
        default: '',
        description:
          'Only mail that arrived after this: a cursor a previous wait returned, or "now". Empty looks back two minutes, so a code that arrived before the wait is not missed.',
      },
      {
        displayName: 'From',
        name: 'from',
        type: 'string',
        default: '',
        description:
          'Only mail from this sender, and only when it passed DMARC, because anybody can write a From',
      },
      {
        displayName: 'Only Mail With a Code',
        name: 'has_code',
        type: 'boolean',
        default: true,
        description: 'Whether to wait for mail Pidgeon found a code in, rather than any mail',
      },
      {
        displayName: 'Subject Contains',
        name: 'subject_contains',
        type: 'string',
        default: '',
      },
    ],
  },
];

export const draftFields: INodeProperties[] = [
  addressField('identityId', show('draft', ['create'])),
  {
    displayName: 'In Reply To',
    name: 'inReplyTo',
    type: 'string',
    default: '',
    displayOptions: show('draft', ['create']),
    description:
      'The message_id it answers, so the draft is threaded as a reply in the recipient’s client too',
  },
  {
    displayName: 'To',
    name: 'to',
    type: 'string',
    default: '',
    displayOptions: show('draft', ['create']),
    description:
      'One address, or several separated by commas. On a reply, usually the sender of the message it answers.',
  },
  {
    displayName: 'Subject',
    name: 'subject',
    type: 'string',
    default: '',
    displayOptions: show('draft', ['create']),
    description: 'Leave empty on a reply to send it as “Re:” and the subject it answers',
  },
  {
    displayName: 'Text',
    name: 'text',
    type: 'string',
    typeOptions: { rows: 6 },
    default: '',
    displayOptions: show('draft', ['create']),
  },
  {
    displayName: 'Additional Fields',
    name: 'additionalFields',
    type: 'collection',
    placeholder: 'Add Field',
    default: {},
    displayOptions: show('draft', ['create']),
    options: [
      {
        displayName: 'BCC',
        name: 'bcc',
        type: 'string',
        default: '',
        description: 'Addresses separated by commas',
      },
      {
        displayName: 'CC',
        name: 'cc',
        type: 'string',
        default: '',
        description: 'Addresses separated by commas',
      },
    ],
  },
  {
    displayName: 'Draft ID',
    name: 'draftId',
    type: 'string',
    required: true,
    default: '',
    displayOptions: show('draft', ['send']),
    description: 'The ID a Save returned',
  },
];

export const threadFields: INodeProperties[] = [
  {
    displayName: 'Thread ID',
    name: 'threadId',
    type: 'string',
    required: true,
    default: '',
    displayOptions: show('thread', ['handToPerson', 'takeBack']),
    description: 'The thread_id from the trigger or a message',
  },
  {
    displayName: 'Assignee Name or ID',
    name: 'assigneeId',
    type: 'options',
    typeOptions: { loadOptionsMethod: 'getMembers' },
    default: '',
    displayOptions: show('thread', ['handToPerson']),
    description:
      'Somebody in your account to give it to, or nobody in particular. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
  },
  {
    displayName: 'Reason',
    name: 'reason',
    type: 'string',
    default: '',
    displayOptions: show('thread', ['handToPerson', 'takeBack']),
    description: 'Shown to the person beside the thread, such as "Complaint about an order"',
  },
];

export const attachmentFields: INodeProperties[] = [
  {
    displayName: 'Attachment ID',
    name: 'attachmentId',
    type: 'string',
    required: true,
    default: '',
    displayOptions: show('attachment', ['download']),
    description: 'An ID from the attachments on a message',
  },
  {
    displayName: 'Put Output File in Field',
    name: 'binaryPropertyName',
    type: 'string',
    required: true,
    default: 'data',
    displayOptions: show('attachment', ['download']),
    hint: 'The name of the output binary field to put the file in',
  },
];
