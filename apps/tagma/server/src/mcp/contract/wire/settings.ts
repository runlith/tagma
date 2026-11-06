import { McpServerDeclaration, McpStdioServerDeclaration } from '@runlith/mcp/declaration';
import { Schema } from 'effect';
import { SETTABLE_SCOPES, settingKey, settingListKey } from '../../../platform/contract/wire/setting.js';

export const mcpServers = settingListKey({
  id: 'mcp.servers',
  order: 750,
  title: 'Servers',
  description:
    'Each declaration names the server, how it is reached and the capabilities its calls are judged by; a secret is written as a ${NAME} reference and resolved when the server connects. A project declines the operator’s own servers by writing declined alone in its layer, keeping the servers it declares itself.',
  control: { kind: 'managed', by: 'add_mcp_server' },
  member: McpServerDeclaration,
  fallback: [] as readonly McpServerDeclaration[],
  scopes: SETTABLE_SCOPES,
  merge: 'concat',
});

export const mcpContributionsOff = settingListKey({
  id: 'mcp.contributionsOff',
  order: 755,
  title: 'Contributed servers switched off',
  description:
    'The names of the servers something enabled in this project contributes, such as a plugin, that this project keeps out of its pool; enable_mcp_server switches one on or off.',
  control: { kind: 'managed', by: 'enable_mcp_server' },
  member: McpStdioServerDeclaration.fields.name,
  fallback: [] as readonly string[],
  scopes: ['project'],
  merge: 'replace',
});

export const mcpClientDocument = settingKey({
  id: 'mcp.clientDocument',
  order: 760,
  title: 'Client metadata document',
  description:
    'The HTTPS address of the OAuth client metadata document Tagma signs into MCP servers with, where a server accepts one; the document Tagma publishes by default, and null skips it for a client the operator registered, then dynamic registration.',
  schema: Schema.NullOr(Schema.String.check(Schema.isStartingWith('https://'))),
  fallback: 'https://tagma.app/oauth/client.json',
  scopes: ['user'],
  merge: 'replace',
});

export const MCP_SETTING_SECTIONS = [
  {
    id: 'mcp',
    order: 60,
    title: 'MCP servers',
    description: 'How agents reach MCP servers: whether a project takes your own servers, and the client Tagma signs in as.',
  },
] as const;
