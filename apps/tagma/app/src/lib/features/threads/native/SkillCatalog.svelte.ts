import type { AgentSkillAim, AgentSkillCatalog } from '@tagma/server/threads/contract/wire/agentLibrary';
import type { Scope } from '@runlith/layer/Scope';
import type { QueryFamily } from '@runlith/query/types';
import type { SkillCatalogKey } from '../library/AgentLibraryRepo.js';

export type SkillsView = {
  readonly label: string;
  readonly items: AgentSkillCatalog['skills'];
  readonly state: 'loading' | 'ready' | 'failed';
  readonly notice: string;
  readonly onOpen: () => Promise<void>;
};

type Reading =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly catalog: AgentSkillCatalog }
  | { readonly kind: 'failed'; readonly message: string };

export class SkillCatalog {
  private state = $state.raw<Reading>({ kind: 'loading' });
  private target: SkillCatalogKey | null = null;
  private address = '';
  private recipient = '';
  private started = 0;
  private reading: Promise<void> | null = null;
  private askedAgainFor: string | null = null;

  constructor(
    private readonly catalogs: QueryFamily<SkillCatalogKey, AgentSkillCatalog>,
    private readonly projectId: number,
    private readonly scope: Scope,
  ) {
    scope.defer(() => {
      this.target = null;
    });
  }

  view = $derived.by<SkillsView>(() => {
    const state = this.state;
    const onOpen = this.refresh;
    if (state.kind === 'loading') return { label: 'Skills', items: [], state: 'loading', notice: 'Loading skills…', onOpen };
    if (state.kind === 'failed') return { label: 'Skills', items: [], state: 'failed', notice: state.message, onOpen };
    return {
      label: state.catalog.basis === 'next-turn' && this.target?.runId ? 'Skills · next turn' : 'Skills',
      items: state.catalog.skills,
      state: 'ready',
      onOpen,
      notice: state.catalog.available ? 'No matching skills.' : (state.catalog.note ?? 'This agent has no available skills.'),
    };
  });

  aim(aim: AgentSkillAim, runId: string | null): void {
    if (this.scope.closed) return;
    const target = { projectId: this.projectId, aim, runId };
    const address = JSON.stringify(target);
    if (address === this.address && this.target !== null) return;
    const recipient = JSON.stringify(aim);
    this.address = address;
    this.target = target;
    this.askedAgainFor = null;
    if (recipient !== this.recipient) this.state = { kind: 'loading' };
    this.recipient = recipient;
    void this.start();
  }

  refresh = async (): Promise<void> => {
    await this.start();
  };

  async refreshCurrent(): Promise<void> {
    await this.reading;
    if (this.scope.closed) return;
    const runId = this.target?.runId;
    if (!runId || runId === this.askedAgainFor) return;
    const state = this.state;
    if (state.kind !== 'ready' || !state.catalog.available || state.catalog.basis !== 'next-turn') return;
    this.askedAgainFor = runId;
    await this.start();
  }

  private start(): Promise<void> {
    const target = this.target;
    if (target === null || this.scope.closed) return Promise.resolve();
    const started = ++this.started;
    const settle = (reading: Reading): void => {
      if (this.scope.closed || started !== this.started) return;
      this.state = reading;
    };
    const failed = (error: unknown): void => settle({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
    try {
      const read = this.scope
        .await(this.catalogs.key(target).refresh({ throwOnError: true }))
        .then((catalog) => {
          settle(
            catalog === undefined
              ? { kind: 'failed', message: 'The skill catalog read was cancelled. Open the menu to try again.' }
              : { kind: 'ready', catalog },
          );
        })
        .catch(failed);
      this.reading = read;
      return read;
    } catch (error) {
      failed(error);
      return Promise.resolve();
    }
  }
}
