import type { RootId } from '@tagma/server/workspace/contract/wire/ids';
import { Repo } from '@runlith/query/repo';
import { Host } from '@runlith/layer/Host';
import { type InstanceOf, Service } from '@runlith/layer/key';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { Door } from '$lib/wire/Door.js';
import { ServerOrigin } from '$lib/wire/ServerOrigin.svelte.js';

export type OutsideFile = {
  readonly projectId: number | null;
  readonly rootId: RootId | null;
  readonly path: string;
  readonly line: number | null;
};

export type PathPlace = { readonly file: OutsideFile; readonly absolute: string };

export const EditorsRepo = Repo.define(
  'editors',
  ({ single }) => ({
    installed: single({
      loader: async ({ signal }, door) => {
        const { status: _, ...read } = await door.perform('read_editors', {}, {}, { signal });
        return read;
      },
    }),
  }),
  { tier: 'app', door: Door },
);

export type EditorsRepo = InstanceOf<typeof EditorsRepo>;

type Installed = NonNullable<EditorsRepo['installed']['data']>;

export type MachineEditor = Installed['editors'][number];

const lensOf = (file: OutsideFile) => (file.projectId === null ? {} : { project: String(file.projectId) });

export class Outside extends Service<Outside>()('Outside', { tier: 'app' }) {
  static *make() {
    return new Outside(yield* EditorsRepo, yield* Door, yield* ServerOrigin, yield* Notices, yield* Host);
  }

  constructor(
    private readonly repo: EditorsRepo,
    private readonly door: Door,
    private readonly origin: ServerOrigin,
    private readonly notices: Notices,
    private readonly host: Host,
  ) {
    super();
  }

  get finder(): string {
    return this.host.os === 'macos' ? 'Reveal in Finder' : 'Show in file manager';
  }

  private shown = $state.raw<readonly (() => OutsideFile)[]>([]);

  get showing(): boolean {
    return this.shown.length > 0;
  }

  current(): OutsideFile | null {
    return this.shown.at(-1)?.() ?? null;
  }

  hold(read: () => OutsideFile): { readonly front: () => void; readonly release: () => void } {
    const release = () => (this.shown = this.shown.filter((one) => one !== read));
    this.shown = [...this.shown, read];
    return {
      front: () => {
        if (this.shown.at(-1) !== read) this.shown = [...this.shown.filter((one) => one !== read), read];
      },
      release,
    };
  }

  get local(): boolean {
    return this.origin.local;
  }

  get editors(): readonly MachineEditor[] {
    return this.local ? (this.repo.installed.data?.editors ?? []) : [];
  }

  get chosen(): MachineEditor | null {
    const chosen = this.local ? (this.repo.installed.data?.chosen ?? null) : null;
    return this.editors.find((editor) => editor.id === chosen) ?? null;
  }

  look(): void {
    if (this.local) void this.repo.installed.refresh();
  }

  async open(file: OutsideFile, editor?: string): Promise<void> {
    if (!this.local) return;
    try {
      await this.door.perform(
        'open_in_editor',
        { root: file.rootId ?? undefined, path: file.path, line: file.line ?? undefined, editor },
        lensOf(file),
      );
      if (editor !== undefined && editor !== this.repo.installed.data?.chosen) void this.repo.installed.refresh();
    } catch (error) {
      this.notices.refusal(error);
      void this.repo.installed.refresh();
    }
  }

  async reveal(file: OutsideFile): Promise<void> {
    if (!this.local) return;
    try {
      await this.door.perform('reveal_entry', { root: file.rootId ?? undefined, path: file.path }, lensOf(file));
    } catch (error) {
      this.notices.refusal(error);
    }
  }
}
