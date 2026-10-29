import { PageId, ProfileId } from '@tagma/server/browser/contract/wire/ids';
import { NO_CONDITIONS } from '@tagma/server/browser/contract/wire/emulation';
import type { Page } from '@tagma/server/browser/contract/wire/page';

export const pageOf = (id: string, over: Partial<Page> = {}): Page => ({
  id: PageId.make(id),
  projectId: 1,
  profile: ProfileId.make('user'),
  url: `https://example.com/${id}`,
  title: id,
  favicon: null,
  openedBy: null,
  opener: null,
  state: 'live',
  host: 'desktop-1',
  live: {
    loading: false,
    back: false,
    forward: false,
    crashed: false,
    responsive: true,
    dialog: null,
    driven: null,
    shown: false,
    conditions: NO_CONDITIONS,
  },
  downloads: 0,
  activeAt: '2026-10-17T12:00:00.000Z',
  closedAt: null,
  ...over,
});
