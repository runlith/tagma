import { Context, type Effect } from 'effect';
import type { Unit } from '../../../platform/contract/service/units.js';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { SessionRef } from '../../../platform/contract/wire/session.js';

export class SessionResolution extends Context.Service<
  SessionResolution,
  {
    resolve(
      unit: Unit<'machine'>,
      input: { readonly session: SessionRef; readonly shellKey: string | null },
    ): Effect.Effect<{ readonly threadId: string; readonly principalId: string; readonly projectId: number } | null, GateRefusal>;
  }
>()('tagma/external-harnesses/SessionResolution') {}
