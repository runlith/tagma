import { embedded, supplied, type Engine, type EngineFiles } from './supply.js';

export const engineFor = (files: EngineFiles): Engine => (process.platform === 'darwin' ? supplied(files) : embedded);
