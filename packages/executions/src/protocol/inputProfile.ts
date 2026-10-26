import { Schema } from 'effect';

export const InputRevision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
export type InputRevision = typeof InputRevision.Type;

export const MouseEncoding = Schema.Literals(['default', 'sgr', 'sgr-pixels']);
export type MouseEncoding = typeof MouseEncoding.Type;

export const XtermInputProfile = Schema.Struct({
  _tag: Schema.Literal('Available'),
  revision: InputRevision,
  profile: Schema.Literal('xterm-256color-unicode11'),
  encoding: Schema.Literal('utf-8'),
  terminal: Schema.Literal('xterm-256color'),
  unicodeVersion: Schema.Literal('11'),
  applicationCursor: Schema.Boolean,
  applicationKeypad: Schema.Boolean,
  bracketedPaste: Schema.Boolean,
  sendFocus: Schema.Boolean,
  mouseTracking: Schema.Literals(['none', 'x10', 'vt200', 'drag', 'any']),
  mouseEncoding: MouseEncoding,
  alternateScreen: Schema.Boolean,
  kittyKeyboardFlags: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type XtermInputProfile = typeof XtermInputProfile.Type;

export const InputProfile = Schema.Union([
  XtermInputProfile,
  Schema.Struct({
    _tag: Schema.Literal('Unavailable'),
    revision: InputRevision,
    reason: Schema.NonEmptyString,
  }),
]);
export type InputProfile = typeof InputProfile.Type;
