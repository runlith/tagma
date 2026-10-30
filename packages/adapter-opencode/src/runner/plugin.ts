import type { Plugin, Rpc } from '@opencode/plugin';
import type { JsonSchema } from 'effect';

export type Preparation = {
  readonly sessionID: string;
  readonly system: string;
  readonly tools: readonly { readonly name: string; readonly description: string; readonly inputSchema: JsonSchema.JsonSchema }[];
};

export const preparation = {
  id: 'tagma',
  methods: {
    prepare: {
      input: {
        type: 'object',
        properties: {
          sessionID: { type: 'string', minLength: 1 },
          system: { type: 'string' },
          tools: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', minLength: 1 },
                description: { type: 'string' },
                inputSchema: { type: 'object' },
              },
              required: ['name', 'description', 'inputSchema'],
              additionalProperties: false,
            },
          },
        },
        required: ['sessionID', 'system', 'tools'],
        additionalProperties: false,
      },
      output: { type: 'null' },
    },
  },
  events: {},
} as const satisfies Rpc.PortableDefinition;

type Content = { readonly type: 'text'; readonly text: string } | { readonly type: 'file'; readonly uri: string; readonly mime: string };
const contentOf = (value: unknown): readonly Content[] => {
  if (!Array.isArray(value)) throw new Error('The hosted callback returned invalid content');
  return value.map((part: unknown): Content => {
    if (typeof part !== 'object' || part === null || !('type' in part)) throw new Error('The hosted callback returned an invalid part');
    if (part.type === 'text' && 'text' in part && typeof part.text === 'string') return { type: 'text', text: part.text };
    if (part.type === 'file' && 'uri' in part && typeof part.uri === 'string' && 'mime' in part && typeof part.mime === 'string')
      return { type: 'file', uri: part.uri, mime: part.mime };
    throw new Error('The hosted callback returned an unsupported part');
  });
};

export default {
  id: 'tagma-hosted',
  async setup(ctx) {
    const endpoint: unknown = ctx.options.endpoint;
    const secret: unknown = ctx.options.secret;
    if (typeof endpoint !== 'string' || typeof secret !== 'string') throw new Error('The hosted plugin has no callback address');
    let frozen: Preparation | null = null;
    await ctx.rpc.register(preparation, {
      async prepare(input) {
        frozen = input as Preparation;
        await ctx.tool.reload();
        return null;
      },
    });
    await ctx.tool.transform((editor) => {
      for (const tool of editor.list()) editor.remove(tool.id);
      for (const tool of frozen?.tools ?? [])
        editor.add({
          name: tool.name,
          description: tool.description,
          input: tool.inputSchema,
          options: { codemode: false },
          async execute(input, context) {
            const response = await fetch(endpoint, {
              method: 'POST',
              headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
              body: JSON.stringify({ sessionID: context.sessionID, messageID: context.messageID, id: context.id, name: tool.name, input }),
              signal: context.signal,
            });
            if (!response.ok) throw new Error(await response.text());
            return { content: contentOf(await response.json()) };
          },
        });
    });
    await ctx.session.hook('context', (event) => {
      if (frozen === null || event.sessionID !== frozen.sessionID) throw new Error('The hosted session has no prepared turn');
      event.system = [{ type: 'text', text: frozen.system }];
      event.messages = event.messages.map((message) => {
        if (message.role !== 'user') return message;
        const images = new Map(
          message.content
            .filter((part) => part.type === 'media' && part.filename?.startsWith('tagma-image-'))
            .map((part) => [part.type === 'media' ? `<${part.filename}>` : '', part]),
        );
        if (images.size === 0) return message;
        const used = new Set<string>();
        for (const part of message.content)
          if (part.type === 'text')
            for (const match of part.text.matchAll(/<tagma-image-[\da-f-]+>/gu)) if (images.has(match[0])) used.add(match[0]);
        const content: Array<(typeof message.content)[number]> = [];
        for (const part of message.content) {
          if (part.type === 'media' && used.has(`<${part.filename}>`)) continue;
          if (part.type !== 'text') {
            content.push(part);
            continue;
          }
          let start = 0;
          for (const match of part.text.matchAll(/<tagma-image-[\da-f-]+>/gu)) {
            const image = images.get(match[0]);
            if (image === undefined) continue;
            if (match.index > start) content.push({ ...part, text: part.text.slice(start, match.index) });
            content.push(image);
            start = match.index + match[0].length;
          }
          if (start < part.text.length) content.push({ ...part, text: part.text.slice(start) });
        }
        return { ...message, content };
      });
      const admitted = new Set(frozen.tools.map((tool) => tool.name));
      event.tools = Object.fromEntries(Object.entries(event.tools).filter(([name]) => admitted.has(name)));
    });
    await ctx.session.hook('title', (event) => {
      event.result = 'Tagma';
    });
  },
} satisfies Plugin.Plugin;
