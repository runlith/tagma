import { Effect } from 'effect';
import type { ApprovalMode, ModeRegistry, ModeUnknown } from '@runlith/agent/modes/ApprovalMode';
import { GateRefusal } from '../../../platform/contract/wire/refusal.js';

export const modeRefusal = (failure: ModeUnknown): GateRefusal<'mode-unknown'> =>
  new GateRefusal('mode-unknown', failure.message, [`name one of the registered modes: ${failure.registered.join(', ')}`]);

export const registeredMode = (modes: ModeRegistry, id: string): Effect.Effect<ApprovalMode, GateRefusal<'mode-unknown'>> =>
  modes.get(id).pipe(Effect.mapError(modeRefusal));
