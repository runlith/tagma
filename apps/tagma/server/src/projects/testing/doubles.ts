import { placeAt as placeAtFn } from '../identity.js';
import { projectsLayer as projectsLayerValue } from '../registration.js';
import { project as projectTable } from '../store/table.js';

export const project = () => projectTable;

export const projectsLayer = () => projectsLayerValue;

export const placeAt = (...input: Parameters<typeof placeAtFn>) => placeAtFn(...input);
