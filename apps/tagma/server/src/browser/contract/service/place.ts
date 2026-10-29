import { Context, type Path } from 'effect';
import type { PageId } from '../wire/ids.js';

export class BrowserPlace extends Context.Service<BrowserPlace, { readonly root: string }>()('tagma/browser/BrowserPlace') {}

export const capturesOf = (path: Path.Path, place: BrowserPlace['Service'], page: PageId): string =>
  path.join(place.root, 'captures', page);

export const tracesOf = (path: Path.Path, place: BrowserPlace['Service'], page: PageId): string => path.join(place.root, 'traces', page);

export const chosenOf = (path: Path.Path, place: BrowserPlace['Service'], page: PageId): string => path.join(place.root, 'chosen', page);
