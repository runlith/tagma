export const PLUGIN_LINK = 'plugin';

export type PluginLinkTarget = { readonly projectId: number; readonly id: string };

export const PLUGINS_FIND_LINK = 'plugins-find';

export type PluginsFindTarget = { readonly projectId: number; readonly query: string };
