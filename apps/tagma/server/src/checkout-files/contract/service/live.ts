import type { LiveDeclaration } from '../../../platform/contract/service/manifest.js';
import type { CheckoutPlaces } from '../../../workspace/contract/service/checkouts.js';
import type { TREE_FEED } from '../wire/directory.js';
import type { DOCUMENT_FEED, LOOSE_DOCUMENT_FEED } from '../wire/document.js';
import type { SEARCH_FEED } from '../wire/search.js';
import type { Directories } from './directories.js';
import type { Documents } from './documents.js';
import type { Searches } from './searches.js';

export type FilesLive = LiveDeclaration<
  readonly [typeof TREE_FEED, typeof SEARCH_FEED, typeof DOCUMENT_FEED, typeof LOOSE_DOCUMENT_FEED],
  CheckoutPlaces | Directories | Searches | Documents
>;
