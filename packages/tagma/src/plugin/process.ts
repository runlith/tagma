import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ErrorCode,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  McpError,
  ReadResourceRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { mcpToolServer } from '@runlith/mcp/server';
import { tagmaClient } from './client.js';
import type { PluginDefinition } from './plugin.js';
import { PLUGIN_ENVIRONMENT as ENVIRONMENT } from './protocol.js';
import { servingOf } from './serving.js';

const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set: Tagma starts a plugin's process with it`);
  return value;
};

export const servePlugin = async (definition: PluginDefinition): Promise<void> => {
  const toStderr = (...parts: unknown[]) => console.error(...parts);
  console.log = toStderr;
  console.info = toStderr;
  console.debug = toStderr;
  const place = { server: process.env[ENVIRONMENT.server] ?? null, caller: required(ENVIRONMENT.caller) };
  const subscribed = new Set<string>();
  let notify: (uri: string) => void = () => undefined;
  const serving = servingOf(definition, {
    data: required(ENVIRONMENT.data),
    options: Object.fromEntries((definition.options ?? []).map((option) => [option.key, process.env[option.key] ?? option.default])),
    client: (project) => tagmaClient(place, project),
    log: (text) => process.stderr.write(`${text}\n`),
    changed: (uri) => notify(uri),
  });
  const server = mcpToolServer({
    name: definition.id,
    version: process.env[ENVIRONMENT.revision] ?? '0',
    tools: () => serving.tools,
    call: (tool, input, meta, _request, signal) => serving.call(tool, input, meta, signal),
  });
  if (serving.resources.length > 0) {
    const low = server.server;
    low.registerCapabilities({ resources: { subscribe: true } });
    const entryOf = ({ name, description, mimeType }: (typeof serving.resources)[number]) => ({ name, description, mimeType });
    low.setRequestHandler(ListResourcesRequestSchema, () => ({
      resources: serving.resources.filter((one) => !one.template).map((one) => ({ ...entryOf(one), uri: one.uri })),
    }));
    low.setRequestHandler(ListResourceTemplatesRequestSchema, () => ({
      resourceTemplates: serving.resources.filter((one) => one.template).map((one) => ({ ...entryOf(one), uriTemplate: one.uri })),
    }));
    low.setRequestHandler(ReadResourceRequestSchema, async (request, extra) => {
      const read = await serving.read(request.params.uri, request.params._meta ?? {}, extra.signal);
      if ('refused' in read) throw new McpError(ErrorCode.InvalidParams, read.refused);
      return { contents: [{ uri: request.params.uri, mimeType: read.mimeType, text: read.text }] };
    });
    low.setRequestHandler(SubscribeRequestSchema, async (request, extra) => {
      const admitted = await serving.read(request.params.uri, request.params._meta ?? {}, extra.signal);
      if ('refused' in admitted) throw new McpError(ErrorCode.InvalidParams, admitted.refused);
      subscribed.add(request.params.uri);
      return {};
    });
    low.setRequestHandler(UnsubscribeRequestSchema, (request) => {
      subscribed.delete(request.params.uri);
      return {};
    });
    notify = (uri) => {
      if (subscribed.has(uri)) void low.sendResourceUpdated({ uri });
    };
  }
  const ended = () => {
    void server.close().finally(() => process.exit(0));
  };
  process.stdin.once('end', ended);
  process.stdin.once('close', ended);
  await server.connect(new StdioServerTransport());
};
