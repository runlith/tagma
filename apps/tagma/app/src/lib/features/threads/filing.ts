import type { ThreadFolder } from '@tagma/server/thread-record/contract/wire/folder';
import type { Notices } from '$lib/features/notices/Service.svelte.js';
import { type FolderPlace, placeOf } from './folderDrop.js';
import type { FolderActs } from './FolderActs.js';
import type { ThreadList } from './List.svelte.js';
import { folderOutline, folderSubtrees } from './tree.js';

type Place = { readonly id: string; readonly folderId: string | null; readonly pinned: boolean };

const TITLE_CHARS = 32;

const PLAIN_WORDS = new Set(
  'the a an of in on for to and with from why does how is are my our its by at into new fix this that'.split(' '),
);

export function folderNameFor(titles: readonly string[]): string {
  if (titles.length < 2) return 'New folder';
  const words = titles.map(
    (title) =>
      new Set(
        title
          .toLowerCase()
          .split(/[^\p{L}\p{N}]+/u)
          .filter((word) => word.length > 2 && !PLAIN_WORDS.has(word)),
      ),
  );
  const [first, ...rest] = words;
  const shared = [...(first ?? [])].find((word) => rest.every((held) => held.has(word)));
  return shared === undefined ? 'New folder' : shared.charAt(0).toUpperCase() + shared.slice(1);
}

export class Filing {
  constructor(
    private readonly list: ThreadList,
    private readonly acts: FolderActs,
    private readonly notices: Notices,
  ) {}

  async file(ids: readonly string[], folderId: string | null): Promise<void> {
    const before = this.placesOf(ids);
    const from = folderId === null ? this.onlyFolder(before) : null;
    if (!(await this.acts.file(ids, folderId))) return;
    const words =
      folderId === null
        ? from === null
          ? `Moved ${this.what(ids)} out of folders`
          : `Took ${this.what(ids)} out of ${from.name}`
        : `Moved ${this.what(ids)} to ${this.folder(folderId)?.name ?? 'the folder'}`;
    this.notice(words, () => this.restore(before));
  }

  async shelve(ids: readonly string[], name: string, parentId: string | null = null): Promise<ThreadFolder | null> {
    const before = this.placesOf(ids);
    const folder = await this.acts.create(name, ids, parentId);
    if (folder === null) return null;
    this.notice(`New folder “${folder.name}”${ids.length === 0 ? '' : ` with ${this.what(ids)}`}`, async () => {
      await this.acts.remove(folder.id);
      await this.restore(before);
    });
    return folder;
  }

  async remove(folder: ThreadFolder): Promise<void> {
    const all = this.list.folders;
    const gone = folderSubtrees(all, [folder.id]);
    const outline = folderOutline(all.filter((held) => gone.has(held.id)));
    const filed = this.list.tree
      .filter((node) => node.row.parentThreadId === null && node.row.folderId != null && gone.has(node.row.folderId))
      .map((node) => node.row.id);
    const before = this.placesOf(filed);
    const at = placeOf(all, folder.id);
    const answer = await this.acts.remove(folder.id);
    if (answer === null) return;
    const count = answer.released.length;
    const inside = outline.length - 1;
    const words = `Removed “${folder.name}”${inside > 0 ? ` and ${inside} ${inside === 1 ? 'folder' : 'folders'}` : ''}`;
    this.notice(`${words} — ${count} ${count === 1 ? 'agent' : 'agents'} back in the list`, async () => {
      const made = new Map<string, string>();
      for (const line of outline) {
        const parentId = line.folder.id === folder.id ? (at?.parentId ?? null) : (made.get(line.folder.parentId ?? '') ?? null);
        const created = await this.acts.create(line.folder.name, [], parentId);
        if (created === null) return;
        made.set(line.folder.id, created.id);
      }
      const top = made.get(folder.id);
      if (top !== undefined && at !== null) await this.acts.move(top, at.parentId, at.index);
      const byFolder = new Map<string, string[]>();
      for (const freed of answer.released) {
        const into = made.get(freed.folderId);
        if (into !== undefined) byFolder.set(into, [...(byFolder.get(into) ?? []), freed.threadId]);
      }
      for (const [folderId, ids] of byFolder) await this.acts.file(ids, folderId);
      for (const place of before) if (place.pinned) await this.list.setPinned(place.id, true);
    });
  }

  async reorder(folderId: string, place: FolderPlace): Promise<void> {
    const before = placeOf(this.list.folders, folderId);
    if (before === null || !(await this.acts.move(folderId, place.parentId, place.index))) return;
    const name = this.folder(folderId)?.name ?? '';
    const words =
      place.parentId === before.parentId
        ? `Moved folder “${name}”`
        : place.parentId === null
          ? `Moved folder “${name}” to the top level`
          : `Moved folder “${name}” into “${this.folder(place.parentId)?.name ?? 'the folder'}”`;
    this.notice(words, async () => {
      await this.acts.move(folderId, before.parentId, before.index);
    });
  }

  async pin(ids: readonly string[]): Promise<void> {
    const unpinned = this.placesOf(ids).filter((place) => !place.pinned);
    for (const place of unpinned) await this.list.setPinned(place.id, true);
    this.notice(`Pinned ${this.what(unpinned.map((place) => place.id))}`, async () => {
      for (const place of unpinned) await this.list.setPinned(place.id, false);
    });
  }

  async archive(ids: readonly string[]): Promise<readonly string[]> {
    const labels = new Map(ids.map((id) => [id, this.list.labelOf(id)] as const));
    const answers = await Promise.all(ids.map((id) => this.list.setArchived(id, true)));
    const took = ids.filter((_id, index) => answers[index]);
    if (took.length > 0) {
      this.notice(`Archived ${this.what(took, (id) => labels.get(id) ?? null)}`, async () => {
        await Promise.all(took.map((id) => this.list.setArchived(id, false)));
      });
    }
    return took;
  }

  private async restore(places: readonly Place[]): Promise<void> {
    const byFolder = new Map<string | null, string[]>();
    for (const place of places) byFolder.set(place.folderId, [...(byFolder.get(place.folderId) ?? []), place.id]);
    for (const [folderId, ids] of byFolder) await this.acts.file(ids, folderId);
    for (const place of places) if (place.pinned) await this.list.setPinned(place.id, true);
  }

  private placesOf(ids: readonly string[]): readonly Place[] {
    return ids.flatMap((id) => {
      const row = this.list.row(id);
      return row === undefined ? [] : [{ id, folderId: row.folderId ?? null, pinned: row.pinnedAt !== null }];
    });
  }

  private onlyFolder(places: readonly Place[]): ThreadFolder | null {
    const ids = new Set(places.map((place) => place.folderId));
    const [only] = ids;
    return ids.size === 1 && only !== undefined && only !== null ? this.folder(only) : null;
  }

  private folder(id: string): ThreadFolder | null {
    return this.list.folders.find((folder) => folder.id === id) ?? null;
  }

  private what(ids: readonly string[], labelOf: (id: string) => string | null = (id) => this.list.labelOf(id)): string {
    if (ids.length !== 1) return `${ids.length} agents`;
    const label = labelOf(ids[0] as string) ?? 'the agent';
    return `“${label.length > TITLE_CHARS ? `${label.slice(0, TITLE_CHARS - 1).trimEnd()}…` : label}”`;
  }

  private notice(text: string, undo: () => Promise<void>): void {
    this.notices.undoable(text, () => void undo(), this.list.life);
  }
}
