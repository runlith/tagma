import { appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { serveMcpOverStdio } from '@runlith/mcp/server';
import { Effect } from 'effect';

const data = process.env.TAGMA_APP_DATA ?? '.';
const journal = (line: string): void => appendFileSync(join(data, 'journal'), `${line}\n`);

journal(`start ${process.pid}`);
process.on('exit', () => journal(`exit ${process.pid}`));
const lingering = process.argv[process.argv.indexOf('--linger') + 1];
if (process.argv.includes('--linger') && lingering !== undefined) {
  setInterval(() => undefined, 60_000);
  process.stdin.on('end', () => appendFileSync(lingering, `eof ${process.pid}\n`));
  process.on('SIGTERM', () => {
    appendFileSync(lingering, `term ${process.pid}\n`);
    process.exit(0);
  });
}

const object = { type: 'object' as const, properties: {} };

const released = async (): Promise<void> => {
  while (!existsSync(join(data, 'release'))) await new Promise((done) => setTimeout(done, 20));
};

const callerKind = (meta: Readonly<Record<string, unknown>>): string => {
  const caller = meta['runlith/caller'];
  return typeof caller === 'object' && caller !== null && 'kind' in caller ? String(caller.kind) : 'none';
};

await Effect.runPromise(
  serveMcpOverStdio({
    name: 'fixture',
    version: '0.0.0',
    tools: () => [
      { name: 'look', description: 'Answers what the caller sees.', inputSchema: object, annotations: { readOnlyHint: true } },
      { name: 'act', description: 'Acts.', inputSchema: object },
      { name: 'deal', description: 'Deals.', inputSchema: object },
      { name: 'pid', description: 'Answers this process id.', inputSchema: object, annotations: { readOnlyHint: true } },
      { name: 'environment', description: 'Answers the variables Tagma handed this process.', inputSchema: object },
      { name: 'crash', description: 'Ends this process at once.', inputSchema: object },
      { name: 'slow', description: 'Answers after a while.', inputSchema: object },
      { name: 'hold', description: 'Answers once the release file stands in the data directory.', inputSchema: object },
      { name: 'ended', description: 'Takes the end of a turn of a thread bound to this app.', inputSchema: object },
    ],
    call: async (tool, args, meta) => {
      if (tool === 'crash') process.exit(3);
      if (tool === 'pid') return { text: String(process.pid) };
      if (tool === 'slow') {
        await new Promise((done) => setTimeout(done, 300));
        return { text: `slow ${process.pid}` };
      }
      if (tool === 'hold') {
        await released();
        return { text: `held ${process.pid}` };
      }
      if (tool === 'ended') {
        journal(`ended ${String(args.runId)} ${String(args.status)} ${process.pid} ${callerKind(meta)}`);
        return { text: 'taken' };
      }
      if (tool === 'environment') {
        return {
          text: JSON.stringify(Object.fromEntries(Object.entries(process.env).filter(([name]) => name.startsWith('TAGMA_')))),
        };
      }
      return { text: `${tool} ${process.pid}` };
    },
  }),
);
