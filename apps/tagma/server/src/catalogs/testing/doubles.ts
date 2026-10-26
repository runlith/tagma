import { catalogs as catalogsFn } from '../install.js';

export const catalogs = (...input: Parameters<typeof catalogsFn>) => catalogsFn(...input);
