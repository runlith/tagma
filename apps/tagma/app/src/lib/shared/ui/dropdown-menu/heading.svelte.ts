import { getContext, setContext } from 'svelte';

const CONTEXT = Symbol('dropdown-menu-group-heading');

export class GroupHeading {
  id = $state<string | undefined>(undefined);

  static make(): GroupHeading {
    const heading = new GroupHeading();
    setContext(CONTEXT, heading);
    return heading;
  }

  static label(id: () => string): void {
    const heading = getContext<GroupHeading | undefined>(CONTEXT);
    if (heading === undefined) return;
    $effect.pre(() => {
      const named = id();
      heading.id = named;
      return () => {
        if (heading.id === named) heading.id = undefined;
      };
    });
  }
}
