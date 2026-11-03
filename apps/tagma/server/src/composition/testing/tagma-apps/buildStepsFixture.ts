import { serveMcpOverStdio } from '@runlith/mcp/server';
import * as BunRuntime from '@effect/platform-bun/BunRuntime';

const calls: { args: Record<string, unknown>; meta: Readonly<Record<string, unknown>> }[] = [];
const object = { type: 'object' as const, properties: {} };

BunRuntime.runMain(
  serveMcpOverStdio({
    name: 'build-steps-fixture',
    version: '0.0.0',
    tools: () => ['pin', 'read'].map((name) => ({ name, description: name, inputSchema: object })),
    call: async (tool, args, meta) => {
      if (tool === 'read') return { text: JSON.stringify(calls) };
      calls.push({ args, meta });
      return { text: JSON.stringify({ verdict: 'stop', reason: 'the pin does not converge', thread: 'thread-1' }) };
    },
  }),
);
