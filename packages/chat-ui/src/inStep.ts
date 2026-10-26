import type { Attachment } from 'svelte/attachments';

export const inStep: Attachment<Element> = (element) => {
  for (const animation of element.getAnimations({ subtree: true })) animation.startTime = 0;
};
