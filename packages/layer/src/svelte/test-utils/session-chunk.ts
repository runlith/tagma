import { Layer } from '../../Layer.js';
import { chunkLoads } from './flagged-fixtures.svelte.js';
import { UserVendor } from './nested-fixtures.svelte.js';

chunkLoads.count += 1;

export default Layer.mergeAll(UserVendor);
