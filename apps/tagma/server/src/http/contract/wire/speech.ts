import { Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { missingSchema, refusalSchema } from '../../../platform/contract/wire/refusal.js';
import { lensQuery } from './Caller.js';

const track = Schema.Struct({ id: Schema.String, track: Schema.String });

export const SpeechGroup = HttpApiGroup.make('speech')
  .add(
    HttpApiEndpoint.get('audio', '/api/speech/listenings/:id/tracks/:track/audio', {
      query: lensQuery,
      params: track,
      headers: Schema.Struct({ range: Schema.optional(Schema.String) }),
      error: [missingSchema, refusalSchema],
    }),
  )
  .add(
    HttpApiEndpoint.get('peaks', '/api/speech/listenings/:id/tracks/:track/peaks', {
      query: lensQuery,
      params: track,
      error: [missingSchema, refusalSchema],
    }),
  );
