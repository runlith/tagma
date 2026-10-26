import { Overlay } from '@runlith/primitives/Overlay.svelte';
import { Presenter } from '@runlith/layer/key';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { NoticeColumn } from '$lib/features/notices/overlay.js';

export class Frame extends Presenter<Frame>()('Frame', { tier: 'app' }) {
  static *make() {
    return new Frame(yield* Overlay, yield* Notices);
  }

  constructor(overlay: Overlay, notices: Notices) {
    super();

    $effect(() => {
      const anything = notices.list.length > 0;
      if (anything === overlay.isOpen(NoticeColumn)) return;
      if (anything) overlay.open(NoticeColumn, {});
      else overlay.close(NoticeColumn);
    });
  }
}
