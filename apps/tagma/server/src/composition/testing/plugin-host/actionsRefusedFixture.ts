import { definePlugin } from '@runlith/tagma/plugin';

export default definePlugin({
  id: 'stray',
  title: 'Stray',
  shortcuts: [{ keys: 'Mod+Alt+S', action: 'sync' }],
});
