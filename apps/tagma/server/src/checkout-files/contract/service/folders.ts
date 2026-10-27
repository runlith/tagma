import { Context, type Stream } from 'effect';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { FolderFrame } from '../wire/scratch.js';

export class LooseFolders extends Context.Service<
  LooseFolders,
  {
    subscribe(directory: string, limit: number): Stream.Stream<FolderFrame, GateRefusal<'files'>>;
  }
>()('tagma/checkout-files/LooseFolders') {}
