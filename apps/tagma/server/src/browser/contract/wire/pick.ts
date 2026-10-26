import { Schema } from 'effect';
import { PageId } from './ids.js';

export const Rect = Schema.Struct({ x: Schema.Number, y: Schema.Number, width: Schema.Number, height: Schema.Number });

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
  picture: Schema.NullOr(Schema.String).annotate({ description: 'The element cropped from the page, base64 PNG.' }),
});
export type Picked = typeof Picked.Type;
