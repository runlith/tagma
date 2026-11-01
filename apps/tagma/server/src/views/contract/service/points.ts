import { ContributionPoint } from '../../../platform/contract/service/contribution.js';
import { LauncherEntries, ResultEntries, SectionEntries, ViewEntries } from '../wire/points.js';

export const VIEWS = new ContributionPoint<never, ViewEntries>('views/views', { name: 'views', schema: ViewEntries });

export const RESULTS = new ContributionPoint<never, ResultEntries>('views/results', { name: 'results', schema: ResultEntries });

export const SURFACES = new ContributionPoint<never, SectionEntries>('views/surfaces', { name: 'surfaces', schema: SectionEntries });

export const PANES = new ContributionPoint<never, SectionEntries>('views/panes', { name: 'panes', schema: SectionEntries });

export const LAUNCHERS = new ContributionPoint<never, LauncherEntries>('views/launchers', { name: 'launchers', schema: LauncherEntries });
