import { admission } from './admission/admit.js';
import { detaching } from './detach.js';
import { nativeDoor, nativeOffers } from './nativeDoor.js';
import { operationPerformer } from './perform.js';
import { registryEntries } from './registryEntries.js';

export const invocationAssembly = {
  admission,
  detaching,
  nativeDoor,
  nativeOffers,
  performer: operationPerformer,
  registryEntries,
};
