import { Schema } from 'effect';

export const RgbColor = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 0xffffff }));
export type RgbColor = typeof RgbColor.Type;

export const TerminalColors = Schema.Struct({
  palette: Schema.Array(RgbColor).check(Schema.isBetweenLength(256, 256)),
  foreground: RgbColor,
  background: RgbColor,
  cursor: RgbColor,
});
export type TerminalColors = typeof TerminalColors.Type;

export const CursorAppearance = Schema.Struct({
  visible: Schema.Boolean,
  style: Schema.Literals(['block', 'underline', 'bar']),
  blink: Schema.Boolean,
});
export type CursorAppearance = typeof CursorAppearance.Type;

export const ScreenAppearance = Schema.Struct({
  colors: TerminalColors,
  cursor: CursorAppearance,
  title: Schema.String,
});
export type ScreenAppearance = typeof ScreenAppearance.Type;
