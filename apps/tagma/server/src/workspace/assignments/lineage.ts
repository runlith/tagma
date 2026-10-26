import { Effect, Layer } from 'effect';
import { ThreadRecords } from '../../thread-record/contract/service/records.js';
import { ThreadLineage } from '../contract/service/assignments.js';

export const lineageOf = (records: ThreadRecords['Service']) =>
  ThreadLineage.of({ projectOf: records.projectOf, isDescendant: records.isDescendant });

export const threadLineageLayer = Layer.effect(ThreadLineage, Effect.map(ThreadRecords, lineageOf));
