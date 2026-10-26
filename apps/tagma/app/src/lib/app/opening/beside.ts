import type { BesidePort } from '$lib/features/opening/Beside.js';
import type { LinkFrom } from '$lib/features/opening/Link.js';
import type { PaneContent } from '$lib/shared/panes/pane.js';
import type { ThreadSeats } from '$lib/features/threads/seats/ThreadSeats.svelte.js';
import type { Placement, SidePanes } from '../panes/SidePanes.svelte.js';

export function besideOf(panes: SidePanes, seats: ThreadSeats): BesidePort {
  const placed = (content: PaneContent, from: LinkFrom | undefined): Placement | null => {
    const layouts = panes.layouts;
    const thread = from?.thread;
    const at = thread === undefined || layouts === null ? null : seats.place(layouts, thread, content);
    return at ?? (layouts === null || panes.holder === null ? null : { layouts, holder: panes.holder });
  };
  return {
    show: ({ content, from, standing: find }) => {
      const at = placed(content, from);
      if (at === null) return false;
      const layout = at.layouts.layout(at.holder);
      const standing = find?.(layout.tabs, layout.active);
      if (standing !== undefined) at.layouts.point(at.holder, standing.key, content.id);
      return panes.openAt(at, content, { quiet: from?.quiet === true }).kind !== 'refused';
    },
    seek: ({ kind, from, match }) => {
      const at = placed({ kind, id: null }, from);
      if (at === null) return 'nowhere';
      const tab = at.layouts.layout(at.holder).tabs.find(match);
      if (tab === undefined) return 'absent';
      if (from?.quiet !== true) panes.openAt(at, { kind: tab.kind, id: tab.id });
      return 'shown';
    },
  };
}
