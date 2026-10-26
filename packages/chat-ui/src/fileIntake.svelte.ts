import type { Attachment } from 'svelte/attachments';
import { draftFileMediaType } from './draftFiles';

type Take = (files: readonly File[]) => void | Promise<void>;

const EDITABLE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

export function pastedFiles(clipboard: DataTransfer): File[] {
  const items = Array.from(clipboard.items)
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null && attachable(file));
  return items.length > 0 ? items : Array.from(clipboard.files).filter(attachable);
}

function attachable(file: File): boolean {
  return file.type.startsWith('image/') || draftFileMediaType(file) !== null;
}

function carriesFiles(transfer: DataTransfer | null): transfer is DataTransfer {
  return transfer !== null && Array.from(transfer.types).includes('Files');
}

export class FileIntake {
  dragging = $state(false);
  private pointed = false;

  constructor(private readonly take: () => Take | undefined) {}

  readonly surface: Attachment<HTMLElement> = (root) => {
    const enter = (event: DragEvent): void => {
      if (!this.take() || !carriesFiles(event.dataTransfer)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      this.dragging = true;
    };
    const drop = (event: DragEvent): void => {
      const take = this.take();
      if (!take || !carriesFiles(event.dataTransfer)) return;
      event.preventDefault();
      this.dragging = false;
      const files = Array.from(event.dataTransfer.files);
      if (files.length > 0) void take(files);
    };
    const point = (event: PointerEvent): void => {
      this.pointed = event.target instanceof Node && root.contains(event.target);
    };
    const paste = (event: ClipboardEvent): void => {
      const take = this.take();
      if (!take || event.defaultPrevented || !event.clipboardData || !this.reaches(root, event.target)) return;
      const files = pastedFiles(event.clipboardData);
      if (files.length === 0) return;
      event.preventDefault();
      void take(files);
    };
    root.addEventListener('dragenter', enter);
    root.addEventListener('dragover', enter);
    root.addEventListener('drop', drop);
    window.addEventListener('pointerdown', point, { capture: true });
    window.addEventListener('paste', paste);
    return () => {
      root.removeEventListener('dragenter', enter);
      root.removeEventListener('dragover', enter);
      root.removeEventListener('drop', drop);
      window.removeEventListener('pointerdown', point, { capture: true });
      window.removeEventListener('paste', paste);
    };
  };

  readonly overlay: Attachment<HTMLElement> = (element) => {
    const leave = (): void => {
      this.dragging = false;
    };
    element.addEventListener('dragleave', leave);
    return () => element.removeEventListener('dragleave', leave);
  };

  private reaches(root: HTMLElement, target: EventTarget | null): boolean {
    if (!(target instanceof Element) || target.closest(EDITABLE) !== null) return false;
    return root.contains(target) || (target === document.body && this.pointed);
  }
}
