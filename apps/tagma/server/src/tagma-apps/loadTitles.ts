import { Effect } from 'effect';
import { type LoadAppTitles, OwnerFactsUnread } from '../executions/contract/service/owners.js';
import type { TagmaApps } from './contract/service/supervision.js';

export const appTitles = (apps: TagmaApps['Service']): LoadAppTitles['Service'] => ({
  read: (projectId) =>
    apps.list(projectId).pipe(
      Effect.map((rows) => new Map(rows.flatMap((row) => (row.title === null ? [] : [[row.id, row.title] as const])))),
      Effect.mapError(() => new OwnerFactsUnread({ reason: `the apps of project ${projectId} could not be listed` })),
    ),
});
