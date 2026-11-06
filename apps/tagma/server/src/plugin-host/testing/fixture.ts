import { appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { serveMcpOverStdio } from '@runlith/mcp/server';
import { Effect } from 'effect';
import { FIXTURE_TOOLS } from './tools.js';

const data = process.env.TAGMA_PLUGIN_DATA ?? '.';
const journal = (line: string): void => appendFileSync(join(data, 'journal'), `${line}\n`);

if (existsSync(join(data, 'refuse'))) {
  journal(`refused ${process.pid}`);
  process.exit(4);
}
journal(`start ${process.pid}`);
process.on('exit', () => journal(`exit ${process.pid}`));
const lingering = process.env.LINGER;
if (lingering !== undefined) {
  setInterval(() => undefined, 60_000);
  process.stdin.on('end', () => appendFileSync(lingering, `eof ${process.pid}\n`));
  process.on('SIGTERM', () => {
    appendFileSync(lingering, `term ${process.pid}\n`);
    process.exit(0);
  });
}

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
    tools: () => FIXTURE_TOOLS,
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
      if (tool === 'asked') {
        journal(`asked ${callerKind(meta)} ${JSON.stringify(args)}`);
        if (existsSync(join(data, 'fail-asked'))) return { text: 'cannot take questions now', isError: true };
        if (existsSync(join(data, 'leave'))) return { text: '', structuredContent: { question: 'left' } };
        return { text: 'taken' };
      }
      if (tool === 'hook') {
        journal(`hook ${callerKind(meta)} ${JSON.stringify(args)}`);
        if (existsSync(join(data, 'fail-hook'))) return { text: 'the keeper is down', isError: true };
        const answer = { deny: `kept by the fixture: ${String(args.tool)}` };
        return { text: JSON.stringify(answer), structuredContent: answer };
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
