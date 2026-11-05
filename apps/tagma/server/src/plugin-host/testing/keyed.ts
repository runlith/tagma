import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { serveMcpOverStdio } from '@runlith/mcp/server';
import { Effect } from 'effect';

appendFileSync(join(process.env.TAGMA_PLUGIN_DATA ?? '.', 'journal'), `start ${process.pid}\n`);

const object = { type: 'object' as const, properties: {} };

await Effect.runPromise(
  serveMcpOverStdio({
    name: 'fixture',
    version: '0.0.0',
    tools: () => [
      { name: 'length', description: 'Answers how long the API_TOKEN given to this process is.', inputSchema: object },
      { name: 'reveal', description: 'Answers the API_TOKEN given to this process.', inputSchema: object },
      { name: 'keyed', description: 'Answers a structure keyed by the API_TOKEN.', inputSchema: object },
    ],
    call: async (tool) => {
      const token = process.env.API_TOKEN;
      if (tool === 'length') return { text: token === undefined ? 'absent' : String(token.length) };
      if (tool === 'keyed') return { text: 'keyed', structuredContent: { [token ?? 'absent']: 'accepted' } };
      return { text: `token=${token ?? 'absent'}` };
    },
  }),
);
