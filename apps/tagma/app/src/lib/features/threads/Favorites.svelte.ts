import { Scope } from '@runlith/layer/Scope';
import { Service } from '@runlith/layer/key';
import { Notices } from '$lib/features/notices/Service.svelte.js';
import { type FavoritePair, movedBefore, toggled } from '../../shared/models/favorites.js';
import { ThreadsRepo } from './Repo.js';

export class Favorites extends Service<Favorites>()('Favorites', { tier: 'app' }) {
  static *make() {
    return new Favorites(yield* ThreadsRepo, yield* Notices, yield* Scope);
  }

  list = $state<readonly FavoritePair[]>([]);
  saving = $state(false);
  private reading: Promise<void> | null = null;

  constructor(
    private readonly threads: ReturnType<typeof ThreadsRepo.use>,
    private readonly notices: Notices,
    private readonly scope: Scope,
  ) {
    super();
    void this.read();
  }

  read(): Promise<void> {
    return (this.reading ??= this.threads.favorites
      .loadOrThrow()
      .then((favorites) => {
        if (!this.scope.signal.aborted && favorites !== undefined) this.list = favorites.models;
      })
      .catch((error: unknown) => {
        this.reading = null;
        if (!this.scope.signal.aborted) this.notices.background(error);
      }));
  }

  toggle(provider: string, model: string): Promise<void> {
    return this.save((list) => toggled(list, { provider, model }));
  }

  move(from: FavoritePair, before: FavoritePair | null): Promise<void> {
    return this.save((list) => movedBefore(list, from, before));
  }

  private async save(next: (list: readonly FavoritePair[]) => readonly FavoritePair[]): Promise<void> {
    if (this.saving) return;
    const previous = this.list;
    const models = next(previous);
    this.list = models;
    this.saving = true;
    try {
      const saved = await this.threads.setFavorites.run({ models }, { throwOnError: true });
      if (!this.scope.signal.aborted && saved !== undefined) this.list = saved.models;
    } catch (error) {
      if (this.scope.signal.aborted) return;
      this.list = previous;
      this.notices.refusal(error);
    } finally {
      this.saving = false;
    }
  }
}
