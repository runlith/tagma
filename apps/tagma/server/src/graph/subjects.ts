import type { SubjectPlace } from '../platform/contract/service/place.js';
import { blockPlace, crossingCall } from './operations/crossing.js';

export const GRAPH_SUBJECTS: readonly SubjectPlace[] = [{ kind: 'block', place: blockPlace, call: crossingCall }];
