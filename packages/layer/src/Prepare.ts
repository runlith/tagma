import { Service } from './key.js';
import type { AnyRung, RungInput } from './Rung.js';

export class Prepare extends Service<<R extends AnyRung>(rung: R, input: RungInput<R>) => Promise<void>>()('Prepare', {
  tier: 'app',
}) {}
