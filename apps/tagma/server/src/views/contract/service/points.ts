import { ContributionPoint } from '../../../platform/contract/service/contribution.js';
import {
  type LauncherEntries,
  LAUNCHERS_FACE,
  PANES_FACE,
  type ResultEntries,
  RESULTS_FACE,
  type SectionEntries,
  SURFACES_FACE,
  type ViewEntries,
  VIEWS_FACE,
} from '../wire/points.js';

export const VIEWS = new ContributionPoint<never, ViewEntries>('views/views', VIEWS_FACE);

export const RESULTS = new ContributionPoint<never, ResultEntries>('views/results', RESULTS_FACE);

export const SURFACES = new ContributionPoint<never, SectionEntries>('views/surfaces', SURFACES_FACE);

export const PANES = new ContributionPoint<never, SectionEntries>('views/panes', PANES_FACE);

export const LAUNCHERS = new ContributionPoint<never, LauncherEntries>('views/launchers', LAUNCHERS_FACE);
