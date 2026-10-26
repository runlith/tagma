import { Layer } from '../../Layer.js';
import { chunkLoads, VendorLayer } from './flagged-fixtures.svelte.js';
import { Gate, UserVendor } from './nested-fixtures.svelte.js';

chunkLoads.count += 1;

export default Layer.mergeAll(
  Layer.when(Gate, (gate) => gate.data.open, VendorLayer),
  Layer.when(Gate, (gate) => gate.data.open, Layer.mergeAll(UserVendor)),
);
