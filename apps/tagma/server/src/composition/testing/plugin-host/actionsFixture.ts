import { action, definePlugin, Refusal, view } from '@runlith/tagma/plugin';

export default definePlugin({
  id: 'keys',
  title: 'Keys',
  views: { board: view('ui/Board.svelte') },
  surfaces: [{ view: 'board', title: 'Boards' }],
  actions: {
    sync: action({ title: 'Sync boards', run: async (ctx) => `Synced from project ${ctx.project}` }),
    push: action({
      title: 'Push boards',
      run: async () => {
        throw new Refusal('The board service is down');
      },
    }),
  },
  shortcuts: [
    { keys: 'Mod+Alt+S', action: 'sync' },
    { keys: 'Mod+Alt+G', action: 'section:board', global: true },
  ],
});
