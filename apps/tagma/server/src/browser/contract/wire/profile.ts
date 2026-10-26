import { Schema } from 'effect';
import { ProfileId } from './ids.js';

export const CONSOLE_CAPTURES = ['auto', 'always', 'never'] as const;
export const ConsoleCapture = Schema.Literals(CONSOLE_CAPTURES).annotate({
  description:
    '`auto` captures console on loopback and private-network pages and on any page after its console is first read; `always` on every driven page; `never` refuses console reads.',
});
export type ConsoleCapture = typeof ConsoleCapture.Type;

export const REMOVALS = ['delete', 'clear'] as const;
export type Removal = (typeof REMOVALS)[number];

export const Profile = Schema.Struct({
  id: ProfileId,
  name: Schema.String,
  adapter: Schema.String,
  console: ConsoleCapture,
  connected: Schema.Boolean,
  removal: Schema.NullOr(Schema.Literals(REMOVALS)),
  createdAt: Schema.String,
});
export type Profile = typeof Profile.Type;

export const PROFILE_NAME_CHARS = 80;

export const ProfileName = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(PROFILE_NAME_CHARS)).annotate({
  description: `The profile's name, at most ${PROFILE_NAME_CHARS} characters.`,
});
