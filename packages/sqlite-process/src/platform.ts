import { embedded, supplied, type Engine, type EngineFiles } from './supply.js';

export const suppliesEngine = process.platform === 'darwin';

export const engineFor = (files: EngineFiles): Engine => (suppliesEngine ? supplied(files) : embedded);
