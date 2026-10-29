import { McpServerDeclaration } from '@runlith/mcp/declaration';
import { Schema } from 'effect';
import { SETTABLE_SCOPES, settingKey, settingListKey } from '../../../platform/contract/wire/setting.js';

export const mcpServers = settingListKey({
  id: 'mcp.servers',
  order: 750,
  title: 'Servers',
  description:
    'Each declaration names the server, how it is reached and the capabilities its calls are judged by; a secret is written as a ${NAME} reference and resolved when the server connects.',
  control: { kind: 'managed', by: 'add_mcp_server' },
  member: McpServerDeclaration,
  fallback: [] as readonly McpServerDeclaration[],
  scopes: SETTABLE_SCOPES,
  merge: 'concat',
});

export const mcpClientDocument = settingKey({
  id: 'mcp.clientDocument',
  order: 760,
  title: 'Client metadata document',
  description:
    'The HTTPS address of the OAuth client metadata document Tagma signs into MCP servers with, where a server accepts one; unset, a sign-in uses a client the operator registered, then dynamic registration.',
  schema: Schema.NullOr(Schema.String.check(Schema.isStartingWith('https://'))),
  fallback: null,
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
