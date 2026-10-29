import { Component, Location } from '@runlith/cdp/describe';
import { Schema } from 'effect';
import { PageId } from './ids.js';

export const Rect = Schema.Struct({ x: Schema.Number, y: Schema.Number, width: Schema.Number, height: Schema.Number });

export const Rendered = Schema.Struct({
  ...Component.fields,
  source: Schema.NullOr(
    Schema.Struct({
      ...Location.fields,
      resolved: Schema.Boolean,
      checkout: Schema.NullOr(Schema.String),
    }),
  ),
});
export type Rendered = typeof Rendered.Type;

export const Picked = Schema.Struct({
  page: PageId,
  url: Schema.String,
  ref: Schema.String,
  role: Schema.String,
  name: Schema.String,
  tag: Schema.String,
  selector: Schema.String,
  text: Schema.String,
  html: Schema.String,
  attributes: Schema.Record(Schema.String, Schema.String),
  styles: Schema.Record(Schema.String, Schema.String),
  rect: Rect,
  component: Schema.optional(Rendered),
  picture: Schema.NullOr(Schema.String).annotate({ description: 'The element cropped from the page, base64 PNG.' }),
});
export type Picked = typeof Picked.Type;
