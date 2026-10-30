import type { Reading, Side } from '@runlith/tagma/rules';
import type { Snapshot } from '../snapshot';
import { callFindings } from './analysis';
import type { CallParams } from './params';
import { worldOf } from './world';

export const callReading = (snapshot: Snapshot, side: Side, params: CallParams): Reading =>
  side.whole
    ? { covered: 'reach', findings: callFindings(worldOf(snapshot), params) }
    : { covered: 'paths', findings: side.paths.length === 0 ? [] : callFindings(worldOf(snapshot), params, snapshot.paths) };
