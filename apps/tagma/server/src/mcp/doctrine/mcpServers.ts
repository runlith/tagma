import type { Section } from '../../platform/contract/wire/section.js';

export const mcpServers: Section = (ctx) => `## The MCP Servers

${ctx.op('read_mcp_servers')} reads which servers this project resolves to and what each is doing now. A server is declared for the project or the operator's own set (${ctx.op('add_mcp_server')}) and dropped from the scope declaring it (${ctx.op('remove_mcp_server')}), which drops its secret values too. A \`\${NAME}\` in a declaration resolves at connect from the value the operator set for that server, then from the process environment, so no token is written into a row; a server lacking one reads \`needs-value\` with the names, and you tell the operator to set them on the server's card, never asking for the value in chat. ${ctx.op('enable_mcp_server')} switches a declared server off — withdrawing its tools, ending its process — or back on as the same server, which dropping and redeclaring would not be.
`;
