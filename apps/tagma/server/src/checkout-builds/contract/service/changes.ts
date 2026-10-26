import { Context, type Stream } from 'effect';
import type { NextIssue } from '../../../installation/contract/wire/next.js';

export type SourceShift = {
  readonly history: boolean;
  readonly watched: boolean;
  readonly paths: Iterable<string> | null;
};

export class SourceChanges extends Context.Service<SourceChanges, { watch(path: string): Stream.Stream<SourceShift, NextIssue> }>()(
  'tagma/checkout-builds/SourceChanges',
) {}
