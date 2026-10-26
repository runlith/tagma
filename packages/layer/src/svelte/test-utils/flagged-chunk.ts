import { Layer } from '../../Layer.js';
import { chunkLoads, Vendor } from './flagged-fixtures.svelte.js';

chunkLoads.count += 1;

export default Layer.mergeAll(Vendor);
