import { ContributionPoint } from '../../../platform/contract/service/contribution.js';
import { LauncherEntries, ResultEntries, SectionEntries, ViewEntries } from '../wire/points.js';

export const VIEWS = new ContributionPoint<never, ViewEntries>('views/views', {
  name: 'views',
  title: 'Pages inside Tagma',
  schema: ViewEntries,
});

export const RESULTS = new ContributionPoint<never, ResultEntries>('views/results', {
  name: 'results',
  title: 'Pages that show what a tool did',
  schema: ResultEntries,
});

export const SURFACES = new ContributionPoint<never, SectionEntries>('views/surfaces', {
  name: 'surfaces',
  title: 'Sections in Tagma’s sidebar',
  schema: SectionEntries,
});

export const PANES = new ContributionPoint<never, SectionEntries>('views/panes', {
  name: 'panes',
  title: 'Panels beside a thread',
  schema: SectionEntries,
});

export const LAUNCHERS = new ContributionPoint<never, LauncherEntries>('views/launchers', {
  name: 'launchers',
  title: 'Windows you open from the palette',
  schema: LauncherEntries,
});
