import { Context, type Effect } from 'effect';
import type { Blocked } from '../wire/access.js';

export class TerminalSite extends Context.Service<TerminalSite, { origin(port: number): Effect.Effect<string, Blocked> }>()(
  'tagma/remote/TerminalSite',
) {}
