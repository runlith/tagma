import { Layer } from '@runlith/layer/Layer';
import { DraftStaging, type StagingDraft } from '$lib/shared/threads/staged.js';
import { ThreadOnScreen } from './OnScreen.svelte.js';

export const Staging = Layer.provide(DraftStaging, function* () {
  const screen = yield* ThreadOnScreen;
  return {
    get host(): StagingDraft | null {
      const host = screen.host;
      if (host === null) return null;
      return {
        get canSend() {
          return host.canSend;
        },
        get thread() {
          return host.activeId === null ? null : { id: host.activeId, projectId: host.projectId };
        },
        stage: (item) => host.draft.stage(item),
        send: () => host.writes.send(),
      };
    },
  };
});
