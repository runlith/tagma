import { Context } from 'effect';
import type { Harness } from '../../../threads/contract/service/harness.js';
import type { HarnessName } from '../../../threads/contract/wire/harness/names.js';

export class HarnessImplementations extends Context.Service<
  HarnessImplementations,
  (name: HarnessName, retract: Harness['Service']['retract']) => Harness['Service']
>()('tagma/external-harnesses/HarnessImplementations') {}
