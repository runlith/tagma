import type { Project } from '@tagma/server/graph/contract/wire/rows';
import { Overlay } from '@runlith/primitives/Overlay.svelte';

export class Cycle {
  index = $state(0);

  constructor(readonly projects: readonly Project[]) {}

  get chosen(): Project {
    return this.projects[this.index] as Project;
  }

  step(direction: 1 | -1): void {
    this.index = (this.index + direction + this.projects.length) % this.projects.length;
  }
}

export const Switcher = Overlay.define<{ cycle: Cycle }>()('tagma/project-switcher', { as: 'launcher' });
