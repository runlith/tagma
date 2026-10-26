import { Schema } from 'effect';
import { PageId } from './ids.js';

const projectId = Schema.Int.check(Schema.isGreaterThan(0));

const length = Schema.Int.check(Schema.isBetween({ minimum: 64, maximum: 8192 }));

export const Budget = Schema.Struct({
  width: length.annotate({ description: 'The CSS width of the viewer’s area.' }),
  height: length.annotate({ description: 'The CSS height of the viewer’s area.' }),
  scale: Schema.Finite.check(Schema.isBetween({ minimum: 0.5, maximum: 4 })).annotate({
    description: 'The most device pixels per CSS pixel the viewer draws.',
  }),
  quality: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 20, maximum: 100 }))).annotate({
    description: 'The JPEG quality the viewer asks for; the stream takes the lowest any viewer asks.',
  }),
  every: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 30 }))).annotate({
    description: 'Every how many rendered frames the viewer wants one; the stream takes the largest.',
  }),
  layout: Schema.optional(Schema.Boolean).annotate({
    description: 'Lay the page out to this viewer’s area. A page with a native view keeps the size its view gives it.',
  }),
});
export type Budget = typeof Budget.Type;

export const ScreencastInput = Schema.Struct({ projectId, page: PageId, ...Budget.fields });

export const Frame = Schema.Struct({
  type: Schema.tag('frame'),
  data: Schema.String.annotate({ description: 'The picture of the viewport, base64 JPEG, as the browser encoded it.' }),
  width: Schema.Finite.annotate({ description: 'The CSS width of the viewport the picture shows.' }),
  height: Schema.Finite.annotate({ description: 'The CSS height of the viewport the picture shows.' }),
});
export type Frame = typeof Frame.Type;

export const ScreencastEvent = Schema.Union([
  Schema.Struct({ type: Schema.tag('viewer'), viewer: Schema.String }),
  Frame,
  Schema.Struct({ type: Schema.tag('chooser'), multiple: Schema.Boolean }),
  Schema.Struct({ type: Schema.tag('chosen') }),
]).pipe(Schema.toTaggedUnion('type'));
export type ScreencastEvent = typeof ScreencastEvent.Type;

const Fraction = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })).annotate({
  description: 'A position across the frame, 0 at its left or top edge and 1 at its right or bottom edge.',
});

const Modifiers = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 15 })).annotate({
  description: 'Held modifiers as CDP bits: Alt 1, Control 2, Meta 4, Shift 8.',
});

export const InputEvent = Schema.Union([
  Schema.Struct({
    kind: Schema.tag('mouse'),
    type: Schema.Literals(['move', 'down', 'up']),
    x: Fraction,
    y: Fraction,
    button: Schema.Literals(['none', 'left', 'middle', 'right']),
    clicks: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3 })),
    modifiers: Modifiers,
  }),
  Schema.Struct({ kind: Schema.tag('wheel'), x: Fraction, y: Fraction, dx: Schema.Finite, dy: Schema.Finite, modifiers: Modifiers }),
  Schema.Struct({
    kind: Schema.tag('key'),
    type: Schema.Literals(['down', 'up']),
    key: Schema.String.check(Schema.isMinLength(1)),
    code: Schema.String,
    modifiers: Modifiers,
  }),
  Schema.Struct({ kind: Schema.tag('text'), text: Schema.String.check(Schema.isMinLength(1)) }),
  Schema.Struct({ kind: Schema.tag('copy') }),
  Schema.Struct({
    kind: Schema.tag('view'),
    width: Budget.fields.width,
    height: Budget.fields.height,
    scale: Budget.fields.scale,
  }).annotate({
    description: 'The viewer’s area changed: the stream and a layout it asked for follow it.',
  }),
]).pipe(Schema.toTaggedUnion('kind'));
export type InputEvent = typeof InputEvent.Type;

export const InputCall = Schema.Struct({
  projectId,
  page: PageId,
  viewer: Schema.String.check(Schema.isMinLength(1)),
  seq: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  events: Schema.Array(InputEvent),
});
export type InputCall = typeof InputCall.Type;

export const InputAnswer = Schema.Struct({
  copied: Schema.NullOr(Schema.String).annotate({ description: 'The text selected on the page when the events held a copy.' }),
});

export const Chosen = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255)),
  bytes: Schema.Uint8Array,
});
export type Chosen = typeof Chosen.Type;

export const FilesCall = Schema.Struct({ projectId, page: PageId, files: Schema.Array(Chosen) });

export const FilesAnswer = Schema.Struct({ chosen: Schema.Int });
