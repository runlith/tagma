import { Effect } from 'effect';
import type { EnforcementCli } from '../../enforcement/cli/port.js';
import { performOver } from '../../platform/contract/service/perform.js';
import { here } from '../../cli/door.js';
import { door } from './door.js';

export const enforcementCli: EnforcementCli = {
  perform: (at) => (declaration, input) =>
    Effect.flatMap(door.client(at), (bound) => performOver(bound.operations.perform)(declaration, input, here(at))),
  baseUrl: door.baseUrl,
};
