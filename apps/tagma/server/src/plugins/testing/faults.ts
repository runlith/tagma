import { PluginFaults } from '../contract/service/plugins.js';

export const unfaulted = PluginFaults.of({ put: () => {}, clear: () => {}, replace: () => {} });
