import type { HarnessAdapter } from '../contract/service/adapter.js';
import { BUILTIN_LOADERS } from './catalog.js';

export const BUILTIN_HARNESSES: readonly HarnessAdapter[] = await Promise.all([...BUILTIN_LOADERS.values()].map((load) => load()));
