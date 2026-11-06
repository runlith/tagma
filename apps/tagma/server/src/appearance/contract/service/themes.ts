import { Context, type Stream } from 'effect';
import { ContributionPoint } from '../../../platform/contract/service/contribution.js';
import type { ThemeCatalog } from '../wire/feeds.js';
import type { ThemeEntries } from '../wire/format.js';
import { THEMES_FACE } from '../wire/points.js';

export const THEMES = new ContributionPoint<never, ThemeEntries>('appearance/themes', THEMES_FACE);

export class Themes extends Context.Service<Themes, { readonly catalog: Stream.Stream<ThemeCatalog> }>()('tagma/appearance/Themes') {}
