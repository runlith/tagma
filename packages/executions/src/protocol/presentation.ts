import { Schema } from 'effect';
import { CursorAppearance, RgbColor, ScreenAppearance, TerminalColors } from './appearance';
import { ExecutionRef } from './execution';
import { InputProfile } from './inputProfile';
import { ByteOffset, TerminalGeometry } from './record';

export const FrameRevision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
export type FrameRevision = typeof FrameRevision.Type;

export const FrameProvenance = Schema.Struct({
  ref: ExecutionRef,
  revision: FrameRevision,
  parsedThrough: ByteOffset,
});
export type FrameProvenance = typeof FrameProvenance.Type;

export const PatchProvenance = Schema.Struct({
  ref: ExecutionRef,
  base: FrameRevision,
  revision: FrameRevision,
  parsedThrough: ByteOffset,
});
export type PatchProvenance = typeof PatchProvenance.Type;

export const BufferKind = Schema.Literals(['normal', 'alternate']);
export type BufferKind = typeof BufferKind.Type;

export const ColorSlot = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Default') }),
  Schema.Struct({ _tag: Schema.Literal('Palette'), index: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 255 })) }),
  Schema.Struct({ _tag: Schema.Literal('Rgb'), value: RgbColor }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type ColorSlot = typeof ColorSlot.Type;

export const UnderlineStyle = Schema.Literals(['none', 'single', 'double', 'curly', 'dotted', 'dashed']);
export type UnderlineStyle = typeof UnderlineStyle.Type;

export const CellStyle = Schema.Struct({
  foreground: ColorSlot,
  background: ColorSlot,
  underlineColor: ColorSlot,
  underline: UnderlineStyle,
  bold: Schema.Boolean,
  dim: Schema.Boolean,
  italic: Schema.Boolean,
  blink: Schema.Boolean,
  inverse: Schema.Boolean,
  invisible: Schema.Boolean,
  strikethrough: Schema.Boolean,
  overline: Schema.Boolean,
});
export type CellStyle = typeof CellStyle.Type;

export const ScreenCell = Schema.Struct({
  chars: Schema.String,
  width: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 2 })),
  style: CellStyle,
});
export type ScreenCell = typeof ScreenCell.Type;

export const ScreenRow = Schema.Struct({
  line: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  wrapped: Schema.Boolean,
  cells: Schema.Array(ScreenCell),
});
export type ScreenRow = typeof ScreenRow.Type;

export const CursorPosition = Schema.Struct({
  line: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  column: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type CursorPosition = typeof CursorPosition.Type;

export const ScreenGeometry = Schema.Struct({
  rows: Schema.Int.check(Schema.isGreaterThan(0)),
  columns: Schema.Int.check(Schema.isGreaterThan(0)),
  firstLine: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  viewportLine: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type ScreenGeometry = typeof ScreenGeometry.Type;

export const ScreenFrame = Schema.Struct({
  _tag: Schema.Literal('ScreenFrame'),
  provenance: FrameProvenance,
  buffer: BufferKind,
  geometry: ScreenGeometry,
  rows: Schema.Array(ScreenRow),
  cursor: CursorPosition,
  appearance: ScreenAppearance,
  input: InputProfile,
});
export type ScreenFrame = typeof ScreenFrame.Type;

export const ScreenPatch = Schema.Struct({
  _tag: Schema.Literal('ScreenPatch'),
  provenance: PatchProvenance,
  buffer: BufferKind,
  geometry: ScreenGeometry,
  rows: Schema.Array(ScreenRow),
  cursor: CursorPosition,
  appearance: ScreenAppearance,
  input: InputProfile,
});
export type ScreenPatch = typeof ScreenPatch.Type;

export const ScreenTextRow = Schema.Struct({
  line: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  wrapped: Schema.Boolean,
  text: Schema.String,
});
export type ScreenTextRow = typeof ScreenTextRow.Type;

export const ScreenRead = Schema.Struct({
  base: Schema.optional(FrameRevision),
  cells: Schema.optional(Schema.Boolean),
  scrollback: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});
export type ScreenRead = typeof ScreenRead.Type;

export const ScreenTextFrame = Schema.Struct({
  _tag: Schema.Literal('ScreenTextFrame'),
  provenance: FrameProvenance,
  buffer: BufferKind,
  geometry: ScreenGeometry,
  rows: Schema.Array(ScreenTextRow),
  cursor: CursorPosition,
  input: InputProfile,
  title: Schema.String,
});
export type ScreenTextFrame = typeof ScreenTextFrame.Type;

export const PaintThemeStep = Schema.Struct({ _tag: Schema.Literal('Theme'), colors: TerminalColors });
export const PaintResizeStep = Schema.Struct({
  _tag: Schema.Literal('Resize'),
  rows: Schema.Int.check(Schema.isGreaterThan(0)),
  columns: Schema.Int.check(Schema.isGreaterThan(0)),
});
export const PaintResetStep = Schema.Struct({ _tag: Schema.Literal('Reset') });
export const PaintWriteStep = Schema.Struct({ _tag: Schema.Literal('Write'), data: Schema.String });
export const PaintCursorStep = Schema.Struct({ _tag: Schema.Literal('Cursor'), cursor: CursorAppearance });
export const PaintTitleStep = Schema.Struct({ _tag: Schema.Literal('Title'), title: Schema.String });
export const PaintScrollStep = Schema.Struct({
  _tag: Schema.Literal('Scroll'),
  top: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  bottom: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  lines: Schema.Int,
});
export const PaintStep = Schema.Union([
  PaintThemeStep,
  PaintResizeStep,
  PaintResetStep,
  PaintWriteStep,
  PaintCursorStep,
  PaintTitleStep,
  PaintScrollStep,
]).pipe(Schema.toTaggedUnion('_tag'));
export type PaintStep = typeof PaintStep.Type;

export const PaintProgram = Schema.Struct({
  _tag: Schema.Literal('PaintProgram'),
  steps: Schema.Array(PaintStep),
});
export type PaintProgram = typeof PaintProgram.Type;

export const ScreenProgramFrame = Schema.Struct({
  _tag: Schema.Literal('ScreenProgramFrame'),
  provenance: FrameProvenance,
  buffer: BufferKind,
  geometry: ScreenGeometry,
  program: PaintProgram,
  input: InputProfile,
});
export type ScreenProgramFrame = typeof ScreenProgramFrame.Type;

export const ScreenProgramPatch = Schema.Struct({
  _tag: Schema.Literal('ScreenProgramPatch'),
  provenance: PatchProvenance,
  buffer: BufferKind,
  geometry: ScreenGeometry,
  program: PaintProgram,
  input: InputProfile,
});
export type ScreenProgramPatch = typeof ScreenProgramPatch.Type;

export const ScreenSubscriptionEnding = Schema.Literals(['completed', 'cancelled', 'gap', 'unavailable', 'closed']);
export type ScreenSubscriptionEnding = typeof ScreenSubscriptionEnding.Type;

export const ScreenUnavailable = Schema.Struct({
  _tag: Schema.Literal('ScreenUnavailable'),
  ref: ExecutionRef,
  parsedThrough: ByteOffset,
  reason: Schema.Literals(['engine', 'profile', 'budget', 'transport', 'closed', 'checkpoint']),
  ending: Schema.optional(ScreenSubscriptionEnding),
  detail: Schema.String,
});
export type ScreenUnavailable = typeof ScreenUnavailable.Type;

export const ScreenAnswer = Schema.Union([ScreenTextFrame, ScreenFrame, ScreenUnavailable]).pipe(Schema.toTaggedUnion('_tag'));
export type ScreenAnswer = typeof ScreenAnswer.Type;

export const ScreenPointRead = Schema.Struct({
  scrollback: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});
export type ScreenPointRead = typeof ScreenPointRead.Type;

export const ScreenPoint = Schema.Struct({
  _tag: Schema.Literal('ScreenPoint'),
  ref: ExecutionRef,
  position: ByteOffset,
  geometry: TerminalGeometry,
});
export type ScreenPoint = typeof ScreenPoint.Type;

export const ScreenPointAnswer = Schema.Union([ScreenPoint, ScreenUnavailable]).pipe(Schema.toTaggedUnion('_tag'));
export type ScreenPointAnswer = typeof ScreenPointAnswer.Type;

export type ScreenPointed = (ScreenPoint & { readonly bytes: Uint8Array }) | ScreenUnavailable;

export const ScreenSnapshot = Schema.Union([ScreenFrame, ScreenProgramFrame]);
export type ScreenSnapshot = typeof ScreenSnapshot.Type;

export const ScreenDelta = Schema.Union([ScreenPatch, ScreenProgramPatch]);
export type ScreenDelta = typeof ScreenDelta.Type;

export const ScreenFeedItem = Schema.Union([ScreenFrame, ScreenPatch, ScreenUnavailable, ScreenProgramFrame, ScreenProgramPatch]).pipe(
  Schema.toTaggedUnion('_tag'),
);
export type ScreenFeedItem = typeof ScreenFeedItem.Type;
