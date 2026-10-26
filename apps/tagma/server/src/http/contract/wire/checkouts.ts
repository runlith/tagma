import { Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { refusalSchema } from '../../../platform/contract/wire/refusal.js';
import { RootId } from '../../../workspace/contract/wire/ids.js';
import { checkoutQuery } from './Caller.js';

export const CheckoutsGroup = HttpApiGroup.make('checkouts')
  .add(
    HttpApiEndpoint.get('picture', '/api/checkouts/:rootId/picture', {
      params: Schema.Struct({ rootId: RootId }),
      query: Schema.Struct({
        ...checkoutQuery.fields,
        project: Schema.optional(Schema.String),
        path: Schema.NonEmptyString,
        at: Schema.NonEmptyString,
      }),
      error: refusalSchema,
    }),
  )
  .add(
    HttpApiEndpoint.get('preview', '/api/files/preview', {
      query: Schema.Struct({
        path: Schema.NonEmptyString,
        full: Schema.optional(Schema.String),
        save: Schema.optional(Schema.NonEmptyString).annotate({ description: 'Answer the whole file as a download under this name.' }),
      }),
      error: refusalSchema,
    }),
  );
