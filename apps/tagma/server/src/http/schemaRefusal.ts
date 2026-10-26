import { Effect } from 'effect';
import { HttpApiMiddleware } from 'effect/http-api';
import { SchemaRefusal, shapeRefusal } from './contract/wire/SchemaRefusal.js';

export const schemaRefusalLayer = HttpApiMiddleware.layerSchemaErrorTransform(SchemaRefusal, (error, { endpoint }) =>
  error.kind === 'Body' || error.kind === 'ResponseHeaders'
    ? Effect.die(error.cause)
    : Effect.fail(
        shapeRefusal(
          endpoint.path === '/api/query' ? 'query-shape' : error.kind === 'Payload' ? 'body-shape' : `${error.kind.toLowerCase()}-shape`,
          error.cause.message,
        ),
      ),
);
