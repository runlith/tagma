import { Schema } from 'effect';

export const TIMELINE_ELEMENT = 'tagma-timeline';

export const TIMELINE_FPS = [24, 25, 30, 50, 60] as const;

export const LONGEST_SECONDS = 300;

export const SIDE_PIXELS = { minimum: 16, maximum: 3840 } as const;

const side = Schema.Int.check(
  Schema.isBetween(SIDE_PIXELS),
  Schema.makeFilter((pixels: number) => pixels % 2 === 0, { expected: 'an even number of pixels, as H.264 requires' }),
);

export const timelineSchema = Schema.Struct({
  v: Schema.Literal(1),
  duration: Schema.Finite.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(LONGEST_SECONDS)),
  fps: Schema.Literals(TIMELINE_FPS),
  width: side,
  height: side,
}).check(
  Schema.makeFilter((declared: { readonly duration: number; readonly fps: number }) => Math.round(declared.duration * declared.fps) >= 1, {
    expected: 'a duration holding at least one frame',
  }),
);

export type Timeline = typeof timelineSchema.Type;

export const frameCount = (timeline: Timeline): number => Math.round(timeline.duration * timeline.fps);

export const frameTime = (timeline: Timeline, k: number): number => k / timeline.fps;

export const frameAt = (timeline: Timeline, seconds: number): number =>
  Math.min(frameCount(timeline) - 1, Math.max(0, Math.floor(seconds * timeline.fps + 1e-6)));

export const HOST_MESSAGES = {
  hello: 'tagma:hello',
  seek: 'tagma:seek',
} as const;

export const PAGE_MESSAGES = {
  ready: 'tagma:ready',
  frame: 'tagma:frame',
} as const;

export const hostMessageSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal(HOST_MESSAGES.hello) }),
  Schema.Struct({ type: Schema.Literal(HOST_MESSAGES.seek), k: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)) }),
]);

export type HostMessage = typeof hostMessageSchema.Type;

export const pageMessageSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal(PAGE_MESSAGES.ready) }),
  Schema.Struct({
    type: Schema.Literal(PAGE_MESSAGES.frame),
    k: Schema.Int,
    error: Schema.optional(Schema.String),
  }),
]);

export type PageMessage = typeof pageMessageSchema.Type;
