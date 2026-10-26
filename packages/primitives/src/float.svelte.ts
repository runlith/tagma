import { untrack } from 'svelte';
import type { Attachment } from 'svelte/attachments';

import type { OverlayLayer } from './layer.svelte.js';
import { overlayLayers, type OverlayLayers } from './OverlayLayers.svelte.js';
import { place, type Align, type PlaceOptions, type Placement, type Point, type Rect, type Side } from './place.js';

export interface VirtualAnchor {
  rect(): Rect;
  readonly element: Element;
}

export type Anchor = HTMLElement | Point | VirtualAnchor;

function elementOf(anchor: Anchor): Element | undefined {
  if (anchor instanceof Element) return anchor;
  return 'element' in anchor ? anchor.element : undefined;
}

function anchorRect(anchor: Anchor): Rect {
  if (anchor instanceof Element) return anchor.getBoundingClientRect();
  if ('rect' in anchor) return anchor.rect();
  return { x: anchor.x, y: anchor.y, width: 0, height: 0 };
}

export class Float {
  placement = $state.raw<Placement | undefined>(undefined);
  anchorWidth = $state(0);

  private element: HTMLElement | null = null;
  private followed: Element | undefined;
  private release: (() => void) | undefined;

  constructor(
    private readonly stack: OverlayLayers,
    private readonly layer: OverlayLayer,
    private readonly anchor: () => Anchor | undefined,
    private readonly options: () => PlaceOptions = () => ({}),
  ) {}

  static make(layer: OverlayLayer, anchor: () => Anchor | undefined, options?: () => PlaceOptions): Float {
    return new Float(overlayLayers, layer, anchor, options);
  }

  get side(): Side | undefined {
    return this.placement?.side;
  }

  get align(): Align | undefined {
    return this.placement?.align;
  }

  get style(): string {
    const seat = `position:fixed;z-index:${this.layer.z};`;
    const at = this.placement;
    if (at === undefined) return `${seat}left:0;top:0;visibility:hidden;`;
    return (
      `${seat}left:${at.x}px;top:${at.y}px;` +
      `--float-anchor-width:${this.anchorWidth}px;--float-available-width:${at.availableWidth}px;` +
      `--float-available-height:${at.availableHeight}px;--float-origin:${at.origin.x}px ${at.origin.y}px;`
    );
  }

  readonly floating: Attachment<HTMLElement> = (element) => {
    this.element = element;
    $effect(() => {
      this.anchor();
      this.options();
      untrack(() => this.update());
    });
    return () => {
      this.release?.();
      this.release = undefined;
      this.followed = undefined;
      if (this.element === element) this.element = null;
    };
  };

  update(): void {
    const element = this.element;
    const anchor = this.anchor();
    if (element === null || anchor === undefined) return;

    const followed = elementOf(anchor);
    if (followed !== undefined && !followed.isConnected) {
      if (this.layer.isOpen) this.layer.dismiss('detached');
      return;
    }
    if (this.release === undefined || followed !== this.followed) {
      this.release?.();
      this.followed = followed;
      this.release = this.stack.track(this, element, followed);
    }
    this.layer.anchorElement = followed instanceof HTMLElement ? followed : null;

    const box = anchorRect(anchor);
    this.anchorWidth = box.width;
    this.placement = place(
      box,
      { width: element.offsetWidth, height: element.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
      this.options(),
    );
  }
}
