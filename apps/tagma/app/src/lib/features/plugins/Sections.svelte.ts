import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { untrack } from 'svelte';
import { ProjectFocus } from '$lib/features/workspace/Focus.svelte.js';
import { PluginActions } from './PluginActions.svelte.js';
import { sectionActions, sectionDeclarations } from './sections.js';
import { ViewSets } from './ViewSets.svelte.js';

export class Sections extends Service<Sections>()('Sections', { tier: 'project', eager: true }) {
  static *make() {
    return new Sections(yield* ViewSets, yield* ProjectFocus, yield* PluginActions, yield* Scope);
  }

  constructor(sets: ViewSets, focus: ProjectFocus, palette: PluginActions, scope: Scope) {
    super();
    const stop = $effect.root(() => {
      $effect(() => {
        if (!focus.current) return;
        const declarations = sectionDeclarations(sets.sets);
        const actions = sectionActions(sets.sets);
        return untrack(() => palette.show(declarations, actions));
      });
    });
    scope.defer(stop);
  }
}
