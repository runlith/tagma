import { Context, type Effect } from 'effect';
import type { ProvedRoot, WorkingOrigin, WorkingRoot, WorkOrigin } from '../wire/place.js';

export class CallerWorkspace extends Context.Service<
  CallerWorkspace,
  { readonly root: string; readonly origin: WorkingOrigin | null } | null
>()('tagma/workspace/CallerWorkspace') {}

export class WorkingOrigins extends Context.Service<
  WorkingOrigins,
  {
    of(work: WorkOrigin, root: string): Effect.Effect<WorkingOrigin | null>;
    rootOf(root: string): Effect.Effect<WorkingRoot | null>;
    placeOf(root: string): Effect.Effect<ProvedRoot | null>;
  }
>()('tagma/workspace/WorkingOrigins') {}
