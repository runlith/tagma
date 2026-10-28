import type { RowSignature } from './recording';

type BodySignature = { value: Omit<RowSignature, 'images' | 'font' | 'fonts'>; first: Element };
const hash = (text: string): number => {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  return value >>> 0;
};

function body(node: HTMLElement): BodySignature {
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
    acceptNode: (text) =>
      text.textContent?.trim() && !text.parentElement?.closest('button, [aria-hidden="true"]')
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT,
  });
  const first = walker.nextNode()?.parentElement ?? node;
  const structure = [...node.querySelectorAll('*')].map((element) => `${element.tagName}:${element.childElementCount}`).join(';');
  return {
    first,
    value: {
      text: hash(node.textContent ?? ''),
      structure: hash(structure),
      anchors: [...node.querySelectorAll('a')].map((anchor) => anchor.textContent ?? ''),
      expanded: [...node.querySelectorAll('[aria-expanded]')].map((control) => control.getAttribute('aria-expanded') ?? ''),
    },
  };
}

export class Signatures {
  private readonly bodies = new WeakMap<HTMLElement, BodySignature>();
  private readonly dirty = new WeakSet<HTMLElement>();
  private readonly observer: MutationObserver;

  constructor(root: HTMLElement) {
    this.observer = new MutationObserver((records) => this.changed(records));
    this.observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
  }

  get(node: HTMLElement): RowSignature {
    this.changed(this.observer.takeRecords());
    let known = this.bodies.get(node);
    if (known === undefined || this.dirty.has(node)) {
      known = body(node);
      this.bodies.set(node, known);
      this.dirty.delete(node);
    }
    const font = getComputedStyle(known.first);
    return {
      ...known.value,
      images: [...node.querySelectorAll('img')].map((image) => ({
        source: hash(image.currentSrc || image.src),
        complete: image.complete,
        width: image.naturalWidth,
        height: image.naturalHeight,
      })),
      font: [font.fontFamily, font.fontSize, font.fontWeight, font.lineHeight, font.fontStretch, font.fontStyle].join('|'),
      fonts: document.fonts.status,
    };
  }

  dispose(): void {
    this.observer.disconnect();
  }

  private changed(records: MutationRecord[]): void {
    for (const record of records) {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      const row = target?.closest<HTMLElement>('[data-timeline-key]');
      if (row !== null && row !== undefined) this.dirty.add(row);
    }
  }
}
