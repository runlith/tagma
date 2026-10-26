import { Schema } from 'effect';

export const PageId = Schema.String.check(Schema.isMinLength(1)).pipe(Schema.brand('PageId'));
export type PageId = typeof PageId.Type;

export const ProfileId = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,63}$/u)).pipe(Schema.brand('ProfileId'));
export type ProfileId = typeof ProfileId.Type;

export const USER_PROFILE = ProfileId.make('user');
export const AGENT_PROFILE = ProfileId.make('agent');

export const REF = /^e[1-9]\d{0,8}$/u;

export const Ref = Schema.String.check(Schema.isPattern(REF)).annotate({
  description: 'An element reference a snapshot or a picked element answered, like `e12`.',
});
