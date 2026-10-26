import type * as Kit from './terminalEngine.js';

export type EngineKit = typeof Kit;

let loaded: EngineKit | null = null;

export const loadedEngine = (): EngineKit | null => loaded;

export const loadEngine = (): Promise<EngineKit> => import('./terminalEngine.js').then((kit) => (loaded = kit));
