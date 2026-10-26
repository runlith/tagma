import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CLI_ENTRY } from '@tagma/server/installation/contract/wire/layout';
import { closureOf } from './installation.js';
import { closureIn, machineWork, reach, type Refusal, stopTagma, working } from './server.js';

export type Leaving = {
  readonly installRoot: string;
  readonly data: string;
  readonly log: string;
  readonly env: NodeJS.ProcessEnv;
  readonly carried: string | null;
};

export type Left = { readonly stopped: false } | { readonly stopped: true; readonly refusal: Refusal | null };

export async function stopAll(places: Leaving): Promise<Refusal | null> {
  if (places.carried !== null && existsSync(join(places.carried, CLI_ENTRY)))
    return stopTagma(closureIn(places.carried), places.log, places.env);
  const planned = await closureOf(places.installRoot);
  if (!('closure' in planned)) return { code: 'no-installation', reason: planned.missing, said: null };
  return stopTagma(planned.closure, places.log, places.env);
}

export async function stopIdle(surfaceUrl: URL, places: Leaving): Promise<Left> {
  if ((await reach(surfaceUrl, places.data)).at !== 'ours') return { stopped: false };
  const work = await machineWork(surfaceUrl);
  if (work === null || working(work)) return { stopped: false };
  return { stopped: true, refusal: await stopAll(places) };
}
