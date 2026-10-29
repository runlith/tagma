import { Schema } from 'effect';
import { arms, operation } from '../../../platform/contract/wire/operation.js';
import { ASKS_NEVER } from '../../../platform/contract/wire/conditions.js';
import { SETTABLE_SCOPES } from '../../../platform/contract/wire/setting.js';
import { projectField } from '../../../platform/contract/wire/place.js';
import { connectorRowSchema } from './rows.js';

const connectorId = Schema.String.check(Schema.isMinLength(1)).annotate({ description: 'The connector, by its catalog id.' });

const located = {
  doors: { http: true },
  subject: 'none',
  place: 'project',
  graph: 'none',
  waits: [],
  lifetimes: [],
  approval: ASKS_NEVER,
} as const;

const operatorActs = { ...located, callers: 'operator', identity: { key: 'call' } } as const;

const STORE_REFUSALS = ['mcp-reconcile-stalled', 'secret-store-failed', 'setting-scope', 'setting-value', 'unknown-project'] as const;

export const CONNECTOR_OPERATIONS = {
  read_connectors: operation('read_connectors', {
    ...located,
    tool: { capability: 'mcp' },
    callers: 'any',
    effect: 'read',
    identity: 'none',
    answer: arms({ ok: { connectors: Schema.Array(connectorRowSchema) } }),
    meaning: 'Read the services Tagma connects in one act, each with its state in this project.',
    grammar:
      'A connected service is an MCP server declared from its entry, and its state is that server’s. Connecting and disconnecting are the operator’s: an agent that needs a service still available asks the operator to connect it.',
    input: Schema.Struct({ project: projectField }),
    refusals: ['secret-store-failed', 'unknown-project'],
    confirmation: () => ({ summary: 'Read the connectors and their state?' }),
    confirmLabel: 'Read',
    presentation: { running: 'Reading the connectors', done: 'Read the connectors' },
    subjects: () => [],
  }),
  connect_service: operation('connect_service', {
    ...operatorActs,
    effect: 'external',
    answer: arms({ ok: { connector: connectorRowSchema, url: Schema.optional(Schema.String) } }),
    meaning: 'Connect a catalog service: declare its remote MCP server and start its sign-in, or ask for its key.',
    grammar: `The server is declared under the connector's id in the scope given, carrying the connector's mark. An OAuth service answers the address of its sign-in page for the operator to open, as sign_in_mcp_server does; a keyed one reads needs-value until set_secret sets the key.
A server of that name already declared in the scope refuses mcp-server-exists.`,
    input: Schema.Struct({
      project: projectField,
      id: connectorId,
      scope: Schema.optional(Schema.Literals(SETTABLE_SCOPES)).annotate({
        description: 'project (default): this project only. user: all projects for this operator.',
      }),
    }),
    refusals: [
      'connector-unknown',
      'mcp-server-exists',
      'mcp-server-unknown',
      'mcp-sign-in-unsupported',
      'mcp-sign-in-failed',
      'mcp-sign-in-unserved',
      ...STORE_REFUSALS,
    ],
    confirmation: (input) => ({ summary: `Connect ${input.id}?` }),
    confirmLabel: 'Connect',
    presentation: { running: 'Connecting a service', done: 'Connected a service' },
    subjects: () => [],
  }),
  disconnect_service: operation('disconnect_service', {
    ...operatorActs,
    effect: 'write',
    answer: arms({ ok: { connector: connectorRowSchema } }),
    meaning: 'Disconnect a service: remove the MCP server declared from it, with its tokens, its values and the client it signed in as.',
    grammar: 'Without a scope it removes the declaration this project resolves to; a connector nothing here was declared from refuses.',
    input: Schema.Struct({
      project: projectField,
      id: connectorId,
      scope: Schema.optional(Schema.Literals(SETTABLE_SCOPES)).annotate({
        description: 'The scope whose declaration goes; the one this project resolves to when omitted.',
      }),
    }),
    refusals: ['connector-unknown', 'connector-unconnected', 'mcp-server-unknown', ...STORE_REFUSALS],
    confirmation: (input) => ({ summary: `Disconnect ${input.id}?` }),
    confirmLabel: 'Disconnect',
    presentation: { running: 'Disconnecting a service', done: 'Disconnected a service' },
    subjects: () => [],
  }),
};
