import { serveMcpOverStdio } from '@runlith/mcp/server';
import * as BunRuntime from '@effect/platform-bun/BunRuntime';

const calls: { tool: string; args: Record<string, unknown>; meta: Readonly<Record<string, unknown>> }[] = [];
const object = { type: 'object' as const, properties: {} };

BunRuntime.runMain(
  serveMcpOverStdio({
    name: 'background-fixture',
    version: '0.0.0',
    tools: () => ['poll', 'outcome', 'read'].map((name) => ({ name, description: name, inputSchema: object })),
    call: async (tool, args, meta) => {
      if (tool === 'read') return { text: JSON.stringify(calls) };
      calls.push({ tool, args, meta });
      return { text: 'taken' };
    },
  }),
);
