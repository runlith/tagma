import { processReader as readProcesses } from '../processes';
import type { LoadedLibrary } from '../Library';
import { compareBirth, bornBetween } from './birth';

export const processWorker = () => new Worker(new URL('./processes.worker.ts', import.meta.url), { type: 'module' });

export const processReader = (library: LoadedLibrary) => readProcesses(library, { compareBirth, bornBetween, worker: processWorker });
