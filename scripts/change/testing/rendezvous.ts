import { join } from 'node:path';

export const rendezvousSource = (directory: string, name: string, other: string): string => `
import { expect, test } from 'bun:test';
import { existsSync, watch, writeFileSync } from 'node:fs';

const started = ${JSON.stringify(join(directory, `${name}.started`))};
const ended = ${JSON.stringify(join(directory, `${name}.ended`))};
const ready = ${JSON.stringify(join(directory, `${name}.ready`))};
const peer = ${JSON.stringify(join(directory, `${other}.started`))};
const peerEnded = ${JSON.stringify(join(directory, `${other}.ended`))};
const peerReady = ${JSON.stringify(join(directory, `${other}.ready`))};

const waitFor = (path: string) => new Promise<void>((resolve) => {
  const check = () => {
    if (!existsSync(path)) return;
    watcher.close();
    resolve();
  };
  const watcher = watch(${JSON.stringify(directory)}, check);
  check();
});

test('runs beside its peer only when the machine has room', async () => {
  writeFileSync(started, '');
  if (process.env.MEET === '1') {
    await waitFor(peer);
    expect(existsSync(peerEnded)).toBe(false);
    writeFileSync(ready, '');
    await waitFor(peerReady);
  } else {
    expect(existsSync(peer) && !existsSync(peerEnded)).toBe(false);
  }
  writeFileSync(ended, '');
});
`;
