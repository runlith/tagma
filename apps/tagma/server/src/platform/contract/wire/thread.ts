import * as Schema from 'effect/Schema';
import { handle } from '@runlith/utils/printed';
import { placeRole } from './place.js';

export const ThreadId = Schema.NonEmptyString.pipe(Schema.brand('ThreadId')).annotate({ ...placeRole('thread'), ...handle() });
export type ThreadId = typeof ThreadId.Type;
