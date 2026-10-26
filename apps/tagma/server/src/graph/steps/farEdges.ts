import { Effect } from 'effect';
import type { ProjectRow } from '../../projects/contract/wire/project.js';

export const farEdges = (_project: ProjectRow): Effect.Effect<void> => Effect.void;
