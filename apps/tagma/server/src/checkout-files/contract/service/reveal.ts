import { Context, type Effect } from 'effect';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { ProjectRoot } from '../../../workspace/contract/wire/coverage.js';

export type RevealRefusal = 'path-outside-tree' | 'graph-path' | 'files';

export class Reveal extends Context.Service<
  Reveal,
  {
    show(place: ProjectRoot, path: string): Effect.Effect<void, GateRefusal<RevealRefusal>>;
    showLoose(path: string): Effect.Effect<void, GateRefusal<RevealRefusal>>;
  }
>()('tagma/checkout-files/Reveal') {}
