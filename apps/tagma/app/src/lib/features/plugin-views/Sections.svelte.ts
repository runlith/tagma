import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { untrack } from 'svelte';
import { Keymap } from '$lib/app/keys/Keymap.svelte.js';
import { ProjectFocus } from '$lib/features/workspace/Focus.svelte.js';
import { PluginActions } from './PluginActions.svelte.js';
import { sectionDeclarations } from './sections.js';
import { ViewSets } from './ViewSets.svelte.js';

export class Sections extends Service<Sections>()('Sections', { tier: 'project', eager: true }) {
  static *make() {
    return new Sections(yield* ViewSets, yield* ProjectFocus, yield* PluginActions, yield* Keymap, yield* Scope);
  }

  constructor(sets: ViewSets, focus: ProjectFocus, plugins: PluginActions, keymap: Keymap, scope: Scope) {
    super();
    const stop = $effect.root(() => {
      $effect(() => {
        if (!focus.current) return;
        const declarations = sectionDeclarations(sets.sets);
        const served = sets.sets.flatMap((set) => (set.site._tag === 'served' ? [set.site.origin] : []));
        return untrack(() => {
          const hidden = plugins.show(declarations);
          const unserved = keymap.serve(served);
          return () => {
            hidden();
            unserved();
          };
        });
      });
    });
    scope.defer(stop);
  }
}
