import type { RootId } from '@tagma/server/workspace/contract/wire/ids';
import { Platform, type PlatformStorage } from '@runlith/layer/Platform';
import { Router, type RoutePathname } from '@runlith/layer/Router';
import { Service } from '@runlith/layer/key';

export const COLUMN_VIEWS = ['files', 'search', 'git'] as const;

export type ColumnView = (typeof COLUMN_VIEWS)[number];

const STORAGE_KEY = 'tagma.checkoutColumn';

const isView = (value: string | null): value is ColumnView => COLUMN_VIEWS.some((view) => view === value);

export type TreePoint = { readonly root: RootId; readonly path: string };

export class Column extends Service<Column>()('Column', { tier: 'app' }) {
  static *make() {
    const platform = yield* Platform;
    return new Column(platform.storage.local, yield* Router);
  }

  view = $state<ColumnView>('files');

  focusing = $state(0);

  pointed = $state.raw<TreePoint | null>(null);

  private unfollow: (() => void) | null = null;

  constructor(
    private readonly storage: PlatformStorage,
    private readonly router: Router,
  ) {
    super();
    const stored = storage.getItem(STORAGE_KEY);
    if (isView(stored)) this.view = stored;
  }

  show(view: ColumnView): void {
    this.view = view;
    this.focusing += 1;
    this.storage.setItem(STORAGE_KEY, view);
  }

  async point(at: TreePoint, href: RoutePathname): Promise<void> {
    this.release(this.pointed);
    const there = new URL(href, this.router.url).pathname;
    this.pointed = at;
    this.show('files');
    this.unfollow = this.router.onNavigate({
      before: (navigation) => {
        if (navigation.to?.url.pathname !== there) this.release(at);
      },
    });
    try {
      await this.router.goto(href);
    } catch (error) {
      this.release(at);
      throw error;
    }
    if (this.router.url.pathname !== there) this.release(at);
  }

  release(at: TreePoint | null): void {
    if (at === null || this.pointed !== at) return;
    this.unfollow?.();
    this.unfollow = null;
    this.pointed = null;
  }
}
