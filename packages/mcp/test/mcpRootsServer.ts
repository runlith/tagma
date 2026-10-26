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

const server = new Server({ name: 'roots', version: '0.0.0' }, { capabilities: { tools: {} } });
let roots: Root[] = [];
let onDemand = false;
let initialized: Promise<void> = Promise.resolve();
const started = Promise.withResolvers<void>();
const released = Promise.withResolvers<void>();
const refresh = async () => {
  roots = (await server.listRoots()).roots;
};
server.oninitialized = () => {
  initialized = refresh();
};
server.setNotificationHandler(RootsListChangedNotificationSchema, () => {
  if (!onDemand) initialized = refresh();
});
server.setRequestHandler(ListToolsRequestSchema, () => ({
  tools: [
    { name: 'ready', inputSchema: { type: 'object' } },
    { name: 'on-demand', inputSchema: { type: 'object' } },
    { name: 'waiting', inputSchema: { type: 'object' } },
    { name: 'release', inputSchema: { type: 'object' } },
    {
      name: 'save',
      inputSchema: { type: 'object', properties: { path: { type: 'string' }, hold: { type: 'boolean' } }, required: ['path'] },
    },
  ],
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === 'ready') {
    await initialized;
    return { content: [{ type: 'text', text: 'ready' }] };
  }
  if (request.params.name === 'on-demand') {
    onDemand = true;
    return { content: [{ type: 'text', text: 'on-demand' }] };
  }
  if (request.params.name === 'waiting') {
    await started.promise;
    return { content: [{ type: 'text', text: 'waiting' }] };
  }
  if (request.params.name === 'release') {
    released.resolve();
    return { content: [{ type: 'text', text: 'released' }] };
  }
  if (request.params.arguments?.hold === true) {
    started.resolve();
    await released.promise;
  }
  await initialized;
  if (onDemand) await refresh();
  const path = String(request.params.arguments?.path);
  const allowed = roots.some((root) => {
    const remainder = relative(fileURLToPath(root.uri), path);
    return remainder === '' || (!isAbsolute(remainder) && remainder !== '..' && !remainder.startsWith('../'));
  });
  if (!allowed) return { isError: true, content: [{ type: 'text', text: 'outside-roots' }] };
  await writeFile(path, 'saved');
  return { content: [{ type: 'text', text: JSON.stringify({ roots, pid: process.pid }) }] };
});
await server.connect(new StdioServerTransport());
