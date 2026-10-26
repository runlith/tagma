import { Context } from 'effect';

export const ReservedNames = Context.Reference<ReadonlySet<string>>('projects/ReservedNames', { defaultValue: () => new Set() });
