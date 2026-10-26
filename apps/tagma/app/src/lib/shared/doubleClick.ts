import type { Attachment } from 'svelte/attachments';

export const DOUBLE_CLICK_MS = 250;
export const DOUBLE_CLICK_PX = 4;

export function doubleClick(onDouble: () => void, enabled: () => boolean = () => true): Attachment<HTMLElement> {
  return (element) => {
    let first: { readonly at: number; readonly x: number; readonly y: number } | null = null;
    const click = (event: MouseEvent): void => {
      const pointed =
        enabled() && event.detail > 0 && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
      if (!pointed) {
        first = null;
        return;
      }
      const near =
        first !== null &&
        event.timeStamp - first.at <= DOUBLE_CLICK_MS &&
        Math.abs(event.clientX - first.x) <= DOUBLE_CLICK_PX &&
        Math.abs(event.clientY - first.y) <= DOUBLE_CLICK_PX;
      if (!near) {
        first = { at: event.timeStamp, x: event.clientX, y: event.clientY };
        return;
      }
      first = null;
      event.preventDefault();
      event.stopPropagation();
      onDouble();
    };
    element.addEventListener('click', click);
    return () => element.removeEventListener('click', click);
  };
}
