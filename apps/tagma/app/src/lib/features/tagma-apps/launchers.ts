import type { Project } from '@tagma/server/graph/contract/wire/rows';
import type { TagmaAppViewSet } from '@tagma/server/views/contract/wire/sets';
import type { WindowAddress } from './windows/ViewWindows.js';

export function launchesOf(sets: readonly TagmaAppViewSet[], project: Project): readonly WindowAddress[] {
  return sets.flatMap((set) =>
    set.launchers.map((launcher) => ({
      projectId: project.id,
      project: project.name,
      tagmaApp: set.app,
      view: launcher.view,
      title: launcher.title,
    })),
  );
}
