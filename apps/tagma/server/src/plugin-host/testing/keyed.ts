import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { serveMcpOverStdio } from '@runlith/mcp/server';
import { Effect } from 'effect';
import { KEYED_TOOLS } from './tools.js';

appendFileSync(join(process.env.TAGMA_PLUGIN_DATA ?? '.', 'journal'), `start ${process.pid}\n`);

await Effect.runPromise(
  serveMcpOverStdio({
    name: 'fixture',
    version: '0.0.0',
    tools: () => KEYED_TOOLS,
    call: async (tool) => {
      const token = process.env.API_TOKEN;
      if (tool === 'length') return { text: token === undefined ? 'absent' : String(token.length) };
      if (tool === 'keyed') return { text: 'keyed', structuredContent: { [token ?? 'absent']: 'accepted' } };
      return { text: `token=${token ?? 'absent'}` };
    },
  }),
);
