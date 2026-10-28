import { Schema } from 'effect';
import type * as DOM from './recording';

const numbers = Schema.mutable(Schema.Array(Schema.Number));
const strings = Schema.mutable(Schema.Array(Schema.String));
const Rect = Schema.Struct({
  top: Schema.Number,
  bottom: Schema.Number,
  left: Schema.Number,
  right: Schema.Number,
  height: Schema.Number,
  width: Schema.Number,
} satisfies Record<keyof DOM.Rect, Schema.Constraint>) satisfies Schema.Codec<DOM.Rect>;
const RailTarget = Schema.Struct({
  target: Schema.String,
  rect: Rect,
} satisfies Record<keyof DOM.RailTarget, Schema.Constraint>) satisfies Schema.Codec<DOM.RailTarget>;
export const Targets = Schema.Struct({
  viewport: Rect,
  host: Rect,
  visual: Schema.NullOr(Rect),
  scale: Schema.Number,
  latest: Schema.NullOr(Rect),
  composer: Schema.NullOr(Rect),
  disclosure: Schema.NullOr(Rect),
  rail: Schema.mutable(Schema.Array(RailTarget)),
} satisfies Record<keyof DOM.Targets, Schema.Constraint>) satisfies Schema.Codec<DOM.Targets>;
const ImageSignature = Schema.Struct({
  source: Schema.Number,
  complete: Schema.Boolean,
  width: Schema.Number,
  height: Schema.Number,
} satisfies Record<keyof DOM.ImageSignature, Schema.Constraint>) satisfies Schema.Codec<DOM.ImageSignature>;
const RowSignature = Schema.Struct({
  text: Schema.Number,
  structure: Schema.Number,
  images: Schema.mutable(Schema.Array(ImageSignature)),
  anchors: strings,
  expanded: strings,
  font: Schema.String,
  fonts: Schema.String,
} satisfies Record<keyof DOM.RowSignature, Schema.Constraint>) satisfies Schema.Codec<DOM.RowSignature>;
const RowRect = Schema.Struct({
  key: Schema.String,
  rect: Rect,
  content: Schema.optional(Rect),
  signature: RowSignature,
  live: Schema.Boolean,
} satisfies Record<keyof DOM.RowRect, Schema.Constraint>) satisfies Schema.Codec<DOM.RowRect>;
const Sentinel = Schema.Struct({
  id: Schema.Number,
  row: Schema.String,
  rect: Rect,
  text: Schema.String,
} satisfies Record<keyof DOM.Sentinel, Schema.Constraint>) satisfies Schema.Codec<DOM.Sentinel>;
const LayoutBox = Schema.Struct({
  id: Schema.Number,
  parent: Schema.NullOr(Schema.Number),
  tag: Schema.String,
  classes: Schema.String,
  rect: Rect,
  height: Schema.String,
  margin: Schema.String,
  padding: Schema.String,
  overflow: Schema.String,
  animations: Schema.mutable(Schema.Array(Schema.Struct({ state: Schema.String, time: Schema.NullOr(Schema.String), end: Schema.String }))),
} satisfies Record<keyof DOM.LayoutBox, Schema.Constraint>) satisfies Schema.Codec<DOM.LayoutBox>;
const Anchor = Schema.Struct({
  kind: Schema.Literals(['paused', 'following', 'disclosure']),
  row: Schema.String,
  rect: Rect,
} satisfies Record<keyof DOM.Anchor, Schema.Constraint>) satisfies Schema.Codec<DOM.Anchor>;
const RowChange = Schema.Struct({
  key: Schema.String,
  kind: Schema.String,
  before: Schema.NullOr(Schema.Number),
  after: Schema.Number,
  beforeWidth: Schema.NullOr(Schema.Number),
  afterWidth: Schema.Number,
  remount: Schema.Boolean,
  frame: Schema.Number,
} satisfies Record<keyof DOM.RowChange, Schema.Constraint>) satisfies Schema.Codec<DOM.RowChange>;
const Mount = Schema.Struct({
  ...RowChange.fields,
  measured: Schema.Boolean,
} satisfies Record<keyof DOM.Mount, Schema.Constraint>) satisfies Schema.Codec<DOM.Mount>;
const Frame = Schema.Struct({
  time: Schema.Number,
  sampled: Schema.Number,
  dpr: Schema.Number,
  scrollTop: Schema.Number,
  scrollHeight: Schema.Number,
  viewport: Rect,
  rows: Schema.mutable(Schema.Array(RowRect)),
  sentinels: Schema.mutable(Schema.Array(Sentinel)),
  blank: Schema.Number,
  rail: Schema.Boolean,
  tiles: Schema.Number,
  gold: Schema.NullOr(Schema.String),
  geometry: Schema.NullOr(Schema.String),
  line: Schema.Number,
  selected: Schema.NullOr(Schema.String),
  mutation: Schema.Number,
  sizeChanges: Schema.Number,
  unmeasured: Schema.Number,
  moving: Schema.Boolean,
  touching: Schema.Boolean,
  finger: Schema.NullOr(Schema.Number),
  structure: Schema.Boolean,
  control: Schema.NullOr(Rect),
  controlRow: Schema.NullOr(Schema.String),
  controlExpanded: Schema.NullOr(Schema.String),
  controlAnimating: Schema.Boolean,
  disclosure: Schema.optional(Schema.mutable(Schema.Array(LayoutBox))),
  anchor: Schema.NullOr(Anchor),
  changes: Schema.mutable(Schema.Array(RowChange)),
  mounts: Schema.mutable(Schema.Array(Mount)),
} satisfies Record<keyof DOM.Frame, Schema.Constraint>) satisfies Schema.Codec<DOM.Frame>;
const Drag = Schema.Struct({
  distance: Schema.Number,
  speed: Schema.Number,
  fromFrame: Schema.Number,
  toFrame: Schema.Number,
  preventFling: Schema.Boolean,
} satisfies Record<keyof DOM.Drag, Schema.Constraint>) satisfies Schema.Codec<DOM.Drag>;
const WheelStep = Schema.Struct({
  frame: Schema.Number,
  deltaY: Schema.Number,
  deltaMode: Schema.Number,
} satisfies Record<keyof DOM.WheelStep, Schema.Constraint>) satisfies Schema.Codec<DOM.WheelStep>;
const WheelRun = Schema.Struct({
  fromFrame: Schema.Number,
  toFrame: Schema.Number,
  steps: Schema.mutable(Schema.Array(WheelStep)),
} satisfies Record<keyof DOM.WheelRun, Schema.Constraint>) satisfies Schema.Codec<DOM.WheelRun>;
const TrustedTouch = Schema.Struct({
  type: Schema.String,
  timeStamp: Schema.Number,
  received: Schema.Number,
  x: Schema.NullOr(Schema.Number),
  y: Schema.NullOr(Schema.Number),
} satisfies Record<keyof DOM.TrustedTouch, Schema.Constraint>) satisfies Schema.Codec<DOM.TrustedTouch>;
const Navigation = Schema.Struct({
  kind: Schema.Literals(['rail', 'latest', 'keyboard']),
  target: Schema.String,
  fromFrame: Schema.Number,
  toFrame: Schema.NullOr(Schema.Number),
  timeStamp: Schema.Number,
  received: Schema.Number,
} satisfies Record<keyof DOM.Navigation, Schema.Constraint>) satisfies Schema.Codec<DOM.Navigation>;
const Scrollbar = Schema.Struct({
  track: Rect,
  x: Schema.Number,
  gutter: Schema.Number,
  viewport: Schema.Number,
  range: Schema.Number,
  top: Schema.Number,
} satisfies Record<keyof DOM.Scrollbar, Schema.Constraint>) satisfies Schema.Codec<DOM.Scrollbar>;
const ThumbSample = Schema.Struct({
  y: Schema.Number,
  time: Schema.Number,
  top: Schema.Number,
} satisfies Record<keyof DOM.ThumbSample, Schema.Constraint>) satisfies Schema.Codec<DOM.ThumbSample>;
const ThumbControl = Schema.Struct({
  scrollbar: Scrollbar,
  samples: Schema.mutable(Schema.Array(ThumbSample)),
  recording: Schema.suspend(() => Recording),
} satisfies Record<keyof DOM.ThumbControl, Schema.Constraint>) satisfies Schema.Codec<DOM.ThumbControl>;
const ThumbReference = Schema.Struct({
  scale: Schema.Number,
  interval: Schema.Number,
  trial: Scrollbar,
  control: Schema.mutable(Schema.Array(ThumbControl)),
} satisfies Record<keyof DOM.ThumbReference, Schema.Constraint>) satisfies Schema.Codec<DOM.ThumbReference>;
const ScrollWrite = Schema.Struct({
  time: Schema.Number,
  frame: Schema.Number,
  method: Schema.Literals(['scrollTop', 'scrollTo', 'scrollBy']),
} satisfies Record<keyof DOM.ScrollWrite, Schema.Constraint>) satisfies Schema.Codec<DOM.ScrollWrite>;

export const Recording: Schema.Codec<DOM.Recording> = Schema.suspend(() =>
  Schema.Struct({
    name: Schema.String,
    frames: Schema.mutable(Schema.Array(Frame)),
    touches: Schema.mutable(Schema.Array(TrustedTouch)),
    drags: Schema.mutable(Schema.Array(Drag)),
    wheels: Schema.mutable(Schema.Array(WheelRun)),
    writes: Schema.optional(Schema.mutable(Schema.Array(ScrollWrite))),
    timings: Schema.optional(numbers),
    ticks: Schema.optional(numbers),
    commands: Schema.optional(Schema.mutable(Schema.Array(Navigation))),
    thumb: Schema.optional(ThumbReference),
  } satisfies Record<keyof DOM.Recording, Schema.Constraint>),
);
export const MeasuredControl = Schema.Struct({
  rows: Schema.Number,
  frames: Schema.Number,
  start: Schema.Number,
  from: Schema.Number,
  to: Schema.Number,
} satisfies Record<keyof DOM.MeasuredControl, Schema.Constraint>) satisfies Schema.Codec<DOM.MeasuredControl>;
