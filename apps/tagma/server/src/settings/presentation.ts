import { Effect } from 'effect';
import { type ModulePresentation, UNVOICED } from '../platform/contract/service/presentation.js';
import { SessionIdentity } from '../platform/contract/wire/session.js';
import { settingsText } from './voice.js';

export const SETTINGS_PRESENTATION: ModulePresentation<SessionIdentity> = {
  voice: Effect.fnUntraced(function* (answer: unknown) {
    return settingsText(answer, yield* SessionIdentity) ?? UNVOICED;
  }),
};
