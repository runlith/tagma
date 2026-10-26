import type { ThreadFolder } from '@tagma/server/thread-record/contract/wire/folder';
import { edgeScroll } from '$lib/shared/edgeScroll.js';
import { lift } from '$lib/shared/lift.js';
import { type FolderHover, type FolderPlace, lineageOf, placeFolder } from './folderDrop.js';

export type DropTarget =
  | { readonly kind: 'folder'; readonly folderId: string }
  | { readonly kind: 'loose' }
  | { readonly kind: 'pinned' }
  | { readonly kind: 'new' }
  | { readonly kind: 'archive' }
  | { readonly kind: 'team'; readonly parentId: string }
  | { readonly kind: 'finished'; readonly parentId: string }
  | { readonly kind: 'mention'; readonly zone: string };

export type Carried =
  | { readonly kind: 'trees'; readonly ids: readonly string[]; readonly label: string }
  | { readonly kind: 'agent'; readonly id: string; readonly parentId: string; readonly label: string }
  | { readonly kind: 'folder'; readonly folderId: string; readonly label: string };

export type CarriedThreads = Exclude<Carried, { readonly kind: 'folder' }>;

export type DragPort = {
  readonly carry: (press: { readonly threadId: string } | { readonly folderId: string }) => Carried | null;
  readonly accepts: (carried: CarriedThreads, target: DropTarget) => boolean;
  readonly drop: (carried: CarriedThreads, target: DropTarget) => void;
  readonly outside: (under: Element) => DropTarget | null;
  readonly follow: (carried: Carried | null, target: DropTarget | null) => void;
  readonly folders: () => readonly ThreadFolder[];
  readonly reorder: (folderId: string, place: FolderPlace) => void;
  readonly isOpen: (folderId: string) => boolean;
  readonly setOpen: (folderId: string, open: boolean) => void;
};

const THRESHOLD_PX = 5;
const SPRING_MS = 650;
const BEFORE_SHARE = 0.3;

function targetOf(drop: string | undefined): DropTarget | null {
  if (drop === undefined) return null;
  if (drop.startsWith('folder:')) return { kind: 'folder', folderId: drop.slice('folder:'.length) };
  if (drop.startsWith('team:')) return { kind: 'team', parentId: drop.slice('team:'.length) };
  if (drop.startsWith('finished:')) return { kind: 'finished', parentId: drop.slice('finished:'.length) };
  if (drop === 'loose' || drop === 'pinned' || drop === 'new' || drop === 'archive') return { kind: drop };
  return null;
}

function dropKey(target: DropTarget): string {
  if (target.kind === 'folder') return `folder:${target.folderId}`;
  if (target.kind === 'team' || target.kind === 'finished') return `${target.kind}:${target.parentId}`;
  if (target.kind === 'mention') return `mention:${target.zone}`;
  return target.kind;
}

export class ColumnDrag {
  carried = $state<Carried | null>(null);
  target = $state<DropTarget | null>(null);
  line = $state<{ readonly top: number; readonly left: number } | null>(null);
  x = $state(0);
  y = $state(0);

  private place: FolderPlace | null = null;
  private release: (() => void) | null = null;
  private spring: { readonly folderId: string; readonly timer: ReturnType<typeof setTimeout> } | null = null;
  private sprung = new Set<string>();
  private frame = 0;

  constructor(private readonly port: DragPort) {}

  attach(list: HTMLElement, column: HTMLElement): () => void {
    const down = (event: PointerEvent): void => {
      if (event.button !== 0 || this.carried !== null || !(event.target instanceof Element)) return;
      if (event.target.closest('input, textarea, [contenteditable], [data-drag-ignore]') !== null) return;
      const head = event.target.closest<HTMLElement>('[data-folder-head]');
      const link = event.target.closest<HTMLElement>('a[data-thread]');
      const what = head?.dataset.folderHead
        ? { folderId: head.dataset.folderHead }
        : link?.dataset.thread
          ? { threadId: link.dataset.thread }
          : null;
      if (what === null) return;
      this.release?.();
      this.release = lift(event, {
        threshold: THRESHOLD_PX,
        lift: (at) => {
          const carried = this.port.carry(what);
          if (carried === null) return false;
          this.carried = carried;
          this.x = at.x;
          this.y = at.y;
          const scroll = (): void => {
            if (this.carried === null) return;
            this.scroll(list);
            this.frame = requestAnimationFrame(scroll);
          };
          this.frame = requestAnimationFrame(scroll);
          return true;
        },
        move: (at) => {
          this.x = at.x;
          this.y = at.y;
          this.hit(list, column);
        },
        drop: () => this.finish(false),
        cancel: () => this.finish(true),
      });
    };
    const nativeDrag = (event: DragEvent): void => {
      if (event.target instanceof Element && event.target.closest('a[data-thread], [data-folder-head]') !== null) event.preventDefault();
    };
    list.addEventListener('pointerdown', down);
    list.addEventListener('dragstart', nativeDrag);
    return () => {
      this.release?.();
      list.removeEventListener('pointerdown', down);
      list.removeEventListener('dragstart', nativeDrag);
    };
  }

  lifts(id: string): boolean {
    const carried = this.carried;
    if (carried === null) return false;
    if (carried.kind === 'trees') return carried.ids.includes(id);
    return carried.kind === 'agent' ? carried.id === id : carried.folderId === id;
  }

  aims(target: DropTarget): boolean {
    return this.aimsAt(dropKey(target));
  }

  aimsAt(key: string): boolean {
    return this.target !== null && dropKey(this.target) === key;
  }

  private hit(list: HTMLElement, column: HTMLElement): void {
    const carried = this.carried;
    if (carried === null) return;
    const under = document.elementFromPoint(this.x, this.y);
    const team = carried.kind === 'agent';
    const inside = under !== null && column.contains(under);
    const zone = inside ? under.closest<HTMLElement>(team ? '[data-team]' : '[data-drop]') : null;
    const zoned = inside
      ? targetOf(team ? zone?.dataset.team : zone?.dataset.drop)
      : under === null || carried.kind === 'folder'
        ? null
        : this.port.outside(under);
    const head = under?.closest<HTMLElement>('[data-folder-head]') ?? null;
    if (carried.kind === 'folder') this.aimFolder(list, carried.folderId, zoned, head);
    else this.target = zoned !== null && this.port.accepts(carried, zoned) ? zoned : null;
    this.port.follow(carried, this.target);
    const folderId = this.target?.kind === 'folder' ? this.target.folderId : null;
    if (folderId !== null && head !== null && !this.port.isOpen(folderId)) {
      if (this.spring?.folderId === folderId) return;
      this.unspring();
      const timer = setTimeout(() => {
        this.spring = null;
        if (this.carried === null) return;
        this.sprung.add(folderId);
        this.port.setOpen(folderId, true);
      }, SPRING_MS);
      this.spring = { folderId, timer };
    } else this.unspring();
  }

  private aimFolder(list: HTMLElement, carriedId: string, zoned: DropTarget | null, head: HTMLElement | null): void {
    let hover: FolderHover | null = null;
    const headId = head?.dataset.folderHead;
    if (head !== null && headId !== undefined) {
      const box = head.getBoundingClientRect();
      hover = this.y < box.top + box.height * BEFORE_SHARE ? { kind: 'before', folderId: headId } : { kind: 'into', folderId: headId };
    } else if (zoned?.kind === 'folder') hover = { kind: 'into', folderId: zoned.folderId };
    else if (zoned?.kind === 'loose') hover = { kind: 'root' };
    this.place = hover === null ? null : placeFolder(this.port.folders(), carriedId, hover);
    this.line = null;
    this.target = null;
    if (this.place === null || hover === null) return;
    if (hover.kind === 'into') this.target = { kind: 'folder', folderId: hover.folderId };
    else if (hover.kind === 'root') this.target = { kind: 'loose' };
    else if (head !== null) {
      const bounds = list.getBoundingClientRect();
      const box = head.getBoundingClientRect();
      const inset = parseFloat(getComputedStyle(head.querySelector('button') ?? head).paddingLeft) || 0;
      this.line = { top: box.top - bounds.top + list.scrollTop, left: box.left - bounds.left + inset };
    }
  }

  private scroll(list: HTMLElement): void {
    const bounds = list.getBoundingClientRect();
    if (this.x < bounds.left || this.x > bounds.right || this.y >= bounds.bottom + 4) return;
    const speed = edgeScroll(this.y, bounds.top, bounds.bottom);
    if (speed !== 0) list.scrollTop += speed;
  }

  private unspring(): void {
    if (this.spring === null) return;
    clearTimeout(this.spring.timer);
    this.spring = null;
  }

  private finish(cancelled: boolean): void {
    const carried = this.carried;
    const target = cancelled ? null : this.target;
    const place = cancelled ? null : this.place;
    cancelAnimationFrame(this.frame);
    this.unspring();
    this.release = null;
    this.carried = null;
    this.target = null;
    this.line = null;
    this.place = null;
    this.port.follow(null, null);
    const landing = carried?.kind === 'folder' ? (place?.parentId ?? null) : target?.kind === 'folder' ? target.folderId : null;
    const kept = lineageOf(this.port.folders(), landing);
    for (const folderId of this.sprung) {
      if (!kept.has(folderId)) this.port.setOpen(folderId, false);
    }
    this.sprung.clear();
    if (carried === null) return;
    if (carried.kind === 'folder') {
      if (place !== null) this.port.reorder(carried.folderId, place);
      return;
    }
    if (target !== null) this.port.drop(carried, target);
  }
}
