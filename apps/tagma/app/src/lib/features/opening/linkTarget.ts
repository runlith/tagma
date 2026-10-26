import type { Resolver } from '@runlith/layer/key';
import type { Attachment } from 'svelte/attachments';
import type { Link } from './Link.js';
import type { Opening } from './Opening.svelte.js';

export type LinkRead = () => Link | null;

const carried = new WeakMap<Element, LinkRead>();

export const carriedLink = (element: Element): Link | null => carried.get(element)?.() ?? null;

export const LINK_OPENED = 'linkopened';

export const linkOpened = (element: Element): void => void element.dispatchEvent(new CustomEvent(LINK_OPENED, { bubbles: true }));

export const onLinkOpened =
  (then: () => void): Attachment<HTMLElement> =>
  (element) => {
    element.addEventListener(LINK_OPENED, then);
    return () => element.removeEventListener(LINK_OPENED, then);
  };

const pressing = (event: MouseEvent): boolean => event.button === 0 && !event.altKey && !event.shiftKey;

const keyed = (event: MouseEvent): boolean =>
  event instanceof PointerEvent ? event.pointerType === '' : event.button === 0 && !event.ctrlKey;

export function pointed(event: MouseEvent): EventTarget | null {
  const target = event.target;
  if (!keyed(event) || !(target instanceof Element) || target !== target.ownerDocument.activeElement) return target;
  const selection = target.ownerDocument.getSelection();
  if (selection === null || selection.rangeCount === 0) return target;
  const { startContainer, startOffset } = selection.getRangeAt(0);
  const at = startContainer instanceof Element ? (startContainer.childNodes[startOffset] ?? startContainer) : startContainer;
  const element = at instanceof Element ? at : at.parentElement;
  return element !== null && target.contains(element) ? element : target;
}

function press(
  opening: Opening,
  element: HTMLElement,
  link: Link | null,
  event: MouseEvent | KeyboardEvent,
  here: Resolver | undefined,
): void {
  if (link === null || !opening.knows(link)) return;
  event.preventDefault();
  event.stopPropagation();
  void opening.open(link, opening.how(opening.modified(event)), here);
  linkOpened(element);
}

function menu(opening: Opening, element: HTMLElement, link: Link | null, event: MouseEvent, here: Resolver | undefined): void {
  if (link === null || !opening.knows(link)) return;
  event.preventDefault();
  event.stopPropagation();
  opening.menu(link, { x: event.clientX, y: event.clientY }, here, element);
}

function listen(
  opening: Opening,
  root: HTMLElement,
  found: (target: EventTarget | null) => HTMLElement | null,
  read: (element: HTMLElement) => Link | null,
  here: Resolver | undefined,
): () => void {
  const click = (event: MouseEvent): void => {
    const element = found(event.target);
    if (element !== null && pressing(event)) press(opening, element, read(element), event, here);
  };
  const key = (event: KeyboardEvent): void => {
    const element = found(event.target);
    if (element !== null && event.target === element && event.key === 'Enter' && !event.altKey && !event.shiftKey)
      press(opening, element, read(element), event, here);
  };
  const context = (event: MouseEvent): void => {
    const element = found(pointed(event));
    if (element !== null) menu(opening, element, read(element), event, here);
  };
  root.addEventListener('click', click);
  root.addEventListener('keydown', key);
  root.addEventListener('contextmenu', context);
  return () => {
    root.removeEventListener('click', click);
    root.removeEventListener('keydown', key);
    root.removeEventListener('contextmenu', context);
  };
}

export function linkTarget(opening: Opening, read: LinkRead, here?: Resolver): Attachment<HTMLElement> {
  return (element) => {
    carried.set(element, read);
    const release = listen(opening, element, (target) => (target instanceof Node && element.contains(target) ? element : null), read, here);
    return () => {
      if (carried.get(element) === read) carried.delete(element);
      release();
    };
  };
}

export function linkSelect(opening: Opening, read: LinkRead, here?: Resolver): (event: Event) => void {
  return (event) => {
    if (event.type === 'click' && event instanceof MouseEvent && pressing(event)) return;
    const link = read();
    if (link === null || !opening.knows(link)) return;
    const keys = event instanceof MouseEvent || event instanceof KeyboardEvent ? event : null;
    void opening.open(link, opening.how(keys !== null && opening.modified(keys)), here);
    if (event.target instanceof Element) linkOpened(event.target);
  };
}

export function linkWithin(
  opening: Opening,
  selector: string,
  read: (element: HTMLElement) => Link | null,
  here?: Resolver,
): Attachment<HTMLElement> {
  return (root) =>
    listen(
      opening,
      root,
      (target) => {
        const element = target instanceof Element ? target.closest<HTMLElement>(selector) : null;
        return element !== null && root.contains(element) ? element : null;
      },
      read,
      here,
    );
}
