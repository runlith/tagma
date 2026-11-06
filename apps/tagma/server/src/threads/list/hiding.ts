import type { PluginListing } from '../contract/service/listing.js';
import { PLUGIN_BINDING } from '../contract/wire/pluginEndings.js';
import type { ThreadSummary } from './summary.js';

export const hiddenRows =
  (listing: PluginListing, current: (id: string) => ThreadSummary | undefined) =>
  (row: ThreadSummary): boolean => {
    let above: ThreadSummary | undefined = row;
    while (above !== undefined) {
      const plugin = above.bindings[PLUGIN_BINDING];
      if (plugin !== undefined && listing.hides(above.projectId, plugin)) return true;
      above = above.parentThreadId === null ? undefined : current(above.parentThreadId);
    }
    return false;
  };
