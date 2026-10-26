import type { Section } from '../../platform/contract/wire/section.js';

export const mcpServers: Section = (ctx) => `## The MCP Servers

${ctx.op('read_mcp_servers')} reads which servers this project resolves to and what each is doing now. A server is declared for the project or the operator's own set (${ctx.op('add_mcp_server')}) and dropped from the scope declaring it (${ctx.op('remove_mcp_server')}); a \`\${NAME}\` in a declaration is read from the process environment at connect, so no token is written into a row. ${ctx.op('enable_mcp_server')} switches a declared server off — withdrawing its tools, ending its process — or back on as the same server, which dropping and redeclaring would not be.
`;
