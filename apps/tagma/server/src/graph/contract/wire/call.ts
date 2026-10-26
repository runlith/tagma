import type { TagTable } from './tags/table.js';
import type { ProjectCaller } from '../../../projects/contract/wire/project.js';

export type NameReach = 'law-and-reflections' | 'every-served-project';

export type Lens = {
  readonly scope: number | undefined;
  readonly names: NameReach;
};

export type ProjectCall = ProjectCaller & {
  readonly vocabulary: TagTable;
  readonly lens: Lens;
  readonly deliveredTags: ReadonlySet<string> | undefined;
};
