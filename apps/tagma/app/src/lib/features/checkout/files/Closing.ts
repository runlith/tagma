import type { Dialogs } from '@runlith/primitives/DialogRegistry.svelte';
import type { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import type { Worktrees } from '$lib/features/worktrees/BoardState.svelte.js';
import type { AutoSave } from './AutoSave.svelte.js';
import type { DocumentPlace } from './documentKey.js';
import type { Documents } from './Documents.svelte.js';
import type { Tab } from './tab.js';
import UnsavedDialog from './UnsavedDialog.svelte';

export const CLOSE_WAIT_MS = 8000;

type Answer = 'save' | 'discard' | 'cancel';

export class Closing {
  constructor(
    private readonly documents: Documents,
    private readonly dialogs: Dialogs,
    private readonly autosave: AutoSave,
    private readonly projectId: number,
    private readonly workspace: Workspace,
    private readonly worktrees: Worktrees,
  ) {}

  unsettled(tab: Tab): boolean {
    return tab.kind === 'file' && this.documents.get(this.placeOf(tab), tab.path)?.unsettled === true;
  }

  async allowed(tabs: readonly Tab[]): Promise<readonly Tab[]> {
    const dirty = tabs.filter((tab) => this.unsettled(tab));
    if (dirty.length === 0) return tabs;
    if (this.autosave.policyOf(this.projectId).mode === 'off') {
      const quiet = dirty.filter((tab) => !this.documents.get(this.placeOf(tab), tab.path)?.unwritable);
      if (quiet.length > 0) {
        const answer = await this.ask(quiet, null);
        if (answer === 'cancel') return [];
        if (answer === 'discard') for (const tab of quiet) this.documents.discard(this.placeOf(tab), tab.path);
      }
    }
    await Promise.race([
      Promise.all(dirty.filter((tab) => this.unsettled(tab)).map((tab) => this.documents.flush(this.placeOf(tab), tab.path))),
      new Promise((resume) => setTimeout(resume, CLOSE_WAIT_MS)),
    ]);
    const stuck = tabs.filter((tab) => this.unsettled(tab));
    if (stuck.length === 0) return tabs;
    if ((await this.ask(stuck, this.reasonOf(stuck))) === 'cancel') return tabs.filter((tab) => !stuck.includes(tab));
    for (const tab of stuck) this.documents.discard(this.placeOf(tab), tab.path);
    return tabs;
  }

  private placeOf(tab: Tab): DocumentPlace {
    return { projectId: this.projectId, rootId: tab.rootId };
  }

  private reasonOf(stuck: readonly Tab[]): string {
    const reasons = new Set(
      stuck.map((tab) => {
        const saving = this.documents.get(this.placeOf(tab), tab.path)?.saving;
        return saving?.kind === 'refused'
          ? saving.reason
          : saving?.kind === 'conflict'
            ? 'it conflicts with the disk'
            : 'the save did not finish';
      }),
    );
    return [...reasons].join('; ');
  }

  private ask(tabs: readonly Tab[], reason: string | null): Promise<Answer> {
    return new Promise((resolve) => {
      const handle = this.dialogs.open(UnsavedDialog, {
        project: this.workspace.find(this.projectId)?.name ?? String(this.projectId),
        paths: tabs.map((tab) => {
          if (tab.rootId === null) return tab.path;
          const row = this.worktrees.byRoot(tab.rootId);
          const branch = row?.branch ?? tab.branch;
          return `${tab.path} · checkout ${row?.folder ?? tab.rootId}${branch === null ? '' : ` (${branch})`}`;
        }),
        reason,
        onSave:
          reason === null
            ? () => {
                handle.close();
                resolve('save');
              }
            : undefined,
        onDiscard: () => {
          handle.close();
          resolve('discard');
        },
        onCancel: () => {
          handle.close();
          resolve('cancel');
        },
      });
      void handle.closed.then(
        () => resolve('cancel'),
        () => resolve('cancel'),
      );
    });
  }
}
