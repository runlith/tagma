import { action, definePlugin } from '@runlith/tagma/plugin';

export default definePlugin({
  id: 'keys',
  title: 'Keys',
  views: [{ id: 'board', entry: 'ui/board.html' }],
  surfaces: [{ view: 'board', title: 'Boards' }],
  actions: { sync: action({ title: 'Sync boards', run: async (ctx) => `Synced from project ${ctx.project}` }) },
  shortcuts: [
    { keys: 'Mod+Alt+S', action: 'sync' },
    { keys: 'Mod+Alt+G', action: 'section:board', global: true },
  ],
});
