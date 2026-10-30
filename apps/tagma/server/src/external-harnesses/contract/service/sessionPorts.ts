import { Context } from 'effect';
import type { Harness } from '../../../threads/contract/service/harness.js';
import type { HarnessAdapter } from './adapter.js';

export class HarnessImplementations extends Context.Service<
  HarnessImplementations,
  (row: HarnessAdapter, retract: Harness['Service']['retract']) => Harness['Service']
>()('tagma/external-harnesses/HarnessImplementations') {}
