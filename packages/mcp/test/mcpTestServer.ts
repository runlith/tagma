import { appendFileSync, writeFileSync } from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js';

const flags = process.argv.slice(2);
if (process.env.MCP_TEST_PID_FILE !== undefined) writeFileSync(process.env.MCP_TEST_PID_FILE, String(process.pid));

if (flags.includes('--hang')) {
  process.stdin.resume();
  setInterval(() => undefined, 60_000);
  if (!flags.includes('--no-exit')) process.stdin.on('end', () => process.exit(0));
} else if (flags.includes('--wide-tools')) {
  const { Server: WideServer } = await import('@modelcontextprotocol/sdk/server/index.js');
  const { StdioServerTransport: WideTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const { ListToolsRequestSchema: WideList } = await import('@modelcontextprotocol/sdk/types.js');
  const wide = new WideServer({ name: 'wide', version: '0.0.0' }, { capabilities: { tools: {} } });
  wide.setRequestHandler(WideList, async () => ({
    tools: Array.from({ length: 23 }, (_, at) => ({
      name: `tool_${at}`,
      description: 'x'.repeat(3400),
      inputSchema: { type: 'object' as const },
    })),
  }));
  await wide.connect(new WideTransport());
} else if (flags.includes('--cursor-loop') || flags.includes('--empty-pages') || flags.includes('--flood-tools')) {
  const { Server: LoopServer } = await import('@modelcontextprotocol/sdk/server/index.js');
  const { StdioServerTransport: LoopTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const { ListToolsRequestSchema: LoopList } = await import('@modelcontextprotocol/sdk/types.js');
  const loop = new LoopServer({ name: 'hostile', version: '0.0.0' }, { capabilities: { tools: {} } });
  let page = 0;
  loop.setRequestHandler(LoopList, async () => {
    page += 1;
    if (flags.includes('--cursor-loop')) {
      return { tools: [{ name: `tool_${page}`, inputSchema: { type: 'object' as const } }], nextCursor: 'same' };
    }
    if (flags.includes('--empty-pages')) return { tools: [], nextCursor: `page-${page}` };
    return {
      tools: Array.from({ length: 2 }, (_, at) => ({
        name: `tool_${page}_${at}`,
        description: 'x'.repeat(1000),
        inputSchema: { type: 'object' as const },
      })),
      nextCursor: `page-${page}`,
    };
  });
  await loop.connect(new LoopTransport());
} else if (flags.includes('--flood')) {
  const times = Number(flags[flags.indexOf('--flood') + 1] ?? 1);
  for (let written = 0; written < times; written += 1) process.stderr.write('щедро'.repeat(64));
  process.stderr.write('\nmodule not found: left-pad\n');
  process.exit(1);
} else if (flags.includes('--die')) {
  process.stderr.write(`${flags[flags.indexOf('--die') + 1] ?? 'died'}\n`);
  process.exit(1);
} else {
  const objectSchema = (properties: Record<string, unknown>, required: readonly string[] = []) => ({
    type: 'object' as const,
    properties,
    required: required.length === 0 ? undefined : [...required],
  });

  const tools = [
    {
      name: 'echo',
      title: 'Echo',
      description: 'Answers the text it was given.',
      inputSchema: objectSchema({ text: { type: 'string' } }),
    },
    { name: 'sleep', description: 'Answers after ms.', inputSchema: objectSchema({ ms: { type: 'number' } }) },
    {
      name: 'env',
      description: 'Answers the names of the variables this process holds.',
      inputSchema: objectSchema({}),
    },
    {
      name: 'fail',
      description: 'Answers a failed result carrying the text.',
      inputSchema: objectSchema({ text: { type: 'string' } }),
    },
    {
      name: 'structured',
      description: 'Answers structured content.',
      inputSchema: objectSchema({}),
      outputSchema: objectSchema({ n: { type: 'number' } }, ['n']),
    },
    { name: 'image', description: 'Answers an image and nothing else.', inputSchema: objectSchema({}) },
    { name: 'pid', description: 'Answers this process id.', inputSchema: objectSchema({}) },
    { name: 'spawn', description: 'Starts a child that outlives stdin and answers its process id.', inputSchema: objectSchema({}) },
    { name: 'meta', description: 'Answers the _meta this call carried.', inputSchema: objectSchema({}) },
    {
      name: 'search',
      description: 'Refuses a call without q.',
      inputSchema: objectSchema({ q: { type: 'string' } }, ['q']),
      annotations: { destructiveHint: false, readOnlyHint: true },
    },
    {
      name: 'grow',
      description: 'Adds the grown tool and announces the change.',
      inputSchema: objectSchema({}),
      annotations: { destructiveHint: true },
    },
  ];
  let grown = false;

  const server = new Server({ name: 'mcp-test-server', version: '0.0.0' }, { capabilities: { tools: { listChanged: true } } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: grown ? [...tools, { name: 'grown', description: 'Appeared after grow.', inputSchema: objectSchema({}) }] : tools,
  }));

  const text = (value: string) => ({ content: [{ type: 'text' as const, text: value }] });

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const args = request.params.arguments ?? {};
    switch (request.params.name) {
      case 'echo':
        if (process.env.MCP_TEST_HOLD_CALL !== undefined) {
          writeFileSync(process.env.MCP_TEST_HOLD_CALL, 'started');
          await new Promise<void>((resolve) => extra.signal.addEventListener('abort', () => resolve(), { once: true }));
        }
        return text(String(args.text ?? ''));
      case 'sleep': {
        const ms = Number(args.ms ?? 0);
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, ms);
          extra.signal.addEventListener('abort', () => {
            clearTimeout(timer);
            resolve();
          });
        });
        return text('slept');
      }
      case 'env':
        return text(JSON.stringify(Object.keys(process.env).sort()));
      case 'fail':
        return { ...text(String(args.text ?? 'failed')), isError: true };
      case 'structured':
        return { ...text('{"n":1}'), structuredContent: { n: 1 } };
      case 'image':
        return { content: [{ type: 'image' as const, data: 'AAAA', mimeType: 'image/png' }] };
      case 'pid':
        return text(String(process.pid));
      case 'spawn': {
        const child = Bun.spawn(['sleep', '600'], { stdio: ['ignore', 'ignore', 'ignore'] });
        child.unref();
        return text(String(child.pid));
      }
      case 'meta':
        return text(JSON.stringify(request.params._meta ?? null));
      case 'search':
        if (typeof args.q !== 'string') throw new McpError(ErrorCode.InvalidParams, 'q is required');
        return text(`results for ${args.q}`);
      case 'grow':
        grown = true;
        await server.sendToolListChanged();
        return text('grown');
      case 'grown':
        return text('the grown tool answered');
      default:
        throw new McpError(ErrorCode.MethodNotFound, `no tool ${request.params.name}`);
    }
  });

  const lingering = process.env.MCP_TEST_LINGER;
  if (lingering !== undefined) {
    setInterval(() => undefined, 60_000);
    process.stdin.on('end', () => appendFileSync(lingering, `eof ${process.pid}\n`));
    process.on('SIGTERM', () => {
      appendFileSync(lingering, `term ${process.pid}\n`);
      process.exit(0);
    });
  }
  const slow = flags.includes('--slow') ? Number(flags[flags.indexOf('--slow') + 1] ?? 0) : 0;
  if (slow > 0) await new Promise<void>((resolve) => setTimeout(resolve, slow));
  await server.connect(new StdioServerTransport());
}
