import { writeFile } from 'node:fs/promises';
import { relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  RootsListChangedNotificationSchema,
  type Root,
} from '@modelcontextprotocol/sdk/types.js';

const onDemand = process.argv.includes('--on-demand');
const server = new Server({ name: 'roots', version: '0.0.0' }, { capabilities: { tools: {} } });
let roots: Root[] | undefined;
let first: Promise<void> | undefined;
const refresh = async () => {
  roots = (await server.listRoots()).roots;
};
server.oninitialized = () => {
  if (!onDemand) first = refresh();
};
server.setNotificationHandler(RootsListChangedNotificationSchema, () => {
  if (!onDemand) void refresh();
});
server.setRequestHandler(ListToolsRequestSchema, () => ({
  tools: [{ name: 'save', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } }],
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (onDemand) await refresh();
  else if (roots === undefined) await first;
  const path = String(request.params.arguments?.path);
  const allowed = (roots ?? []).some((root) => {
    const remainder = relative(fileURLToPath(root.uri), path);
    return remainder === '' || (!isAbsolute(remainder) && remainder !== '..' && !remainder.startsWith('../'));
  });
  if (!allowed) return { isError: true, content: [{ type: 'text', text: 'outside-roots' }] };
  await writeFile(path, 'saved');
  return { content: [{ type: 'text', text: 'saved' }] };
});
await server.connect(new StdioServerTransport());
