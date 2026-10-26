import type { Page } from '@tagma/server/browser/contract/wire/page';

export type PageAdapter = 'native' | 'cast';

export const adapterOf = (page: Page, bridge: string | null): PageAdapter => (bridge !== null && page.host === bridge ? 'native' : 'cast');
