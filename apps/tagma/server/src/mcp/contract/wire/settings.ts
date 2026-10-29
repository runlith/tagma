import { McpHttpServerDeclaration, McpStdioServerDeclaration } from '@runlith/mcp/declaration';
import { Schema } from 'effect';
import { SETTABLE_SCOPES, settingKey, settingListKey } from '../../../platform/contract/wire/setting.js';

const marked = {
  connector: Schema.optional(Schema.String.check(Schema.isMinLength(1))).annotate({
    description: 'The connector this server was declared from, by its catalog id.',
  }),
};

export const McpServerSetting = Schema.Union([
  Schema.Struct({ ...McpStdioServerDeclaration.fields, ...marked }),
  Schema.Struct({ ...McpHttpServerDeclaration.fields, ...marked }),
]);
export type McpServerSetting = typeof McpServerSetting.Type;

export const mcpServers = settingListKey({
  id: 'mcp.servers',
  order: 750,
  title: 'Servers',
  description:
    'Each declaration names the server, how it is reached and the capabilities its calls are judged by; a secret is written as a ${NAME} reference and resolved when the server connects. A project declines the operator’s own servers by writing declined alone in its layer, keeping the servers it declares itself.',
  control: { kind: 'managed', by: 'add_mcp_server' },
  member: McpServerSetting,
  fallback: [] as readonly McpServerSetting[],
  scopes: SETTABLE_SCOPES,
  merge: 'concat',
});

export const mcpClientDocument = settingKey({
  id: 'mcp.clientDocument',
  order: 760,
  title: 'Client metadata document',
  description:
    'The HTTPS address of the OAuth client metadata document Tagma signs into MCP servers with, where a server accepts one; the document Tagma publishes by default, and null skips it for a client the operator registered, then dynamic registration.',
  schema: Schema.NullOr(Schema.String.check(Schema.isStartingWith('https://'))),
  fallback: 'https://tagma.dev/oauth/client.json',
  scopes: ['user'],
  merge: 'replace',
});

export const MCP_SETTING_SECTIONS = [
  {
    id: 'mcp',
    order: 60,
    title: 'MCP servers',
    description: 'The MCP servers whose tools the agent is offered, each with the authority its calls are judged by.',
  },
] as const;
