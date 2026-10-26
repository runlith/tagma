import type { Runtime } from '../runtime';
import { browser } from './browser';
import { bun } from './bun';
import { node } from './node';

export const RUNTIMES: readonly Runtime[] = [browser, node, bun];

const NAMED: ReadonlyMap<string, Runtime> = new Map(RUNTIMES.map((runtime) => [runtime.id, runtime]));

export const runtimeNamed = (id: string): Runtime | undefined => NAMED.get(id);
