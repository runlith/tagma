import { ContributionPoint } from '../../../platform/contract/service/contribution.js';
import {
  type ActionEntries,
  ACTIONS_FACE,
  type CommandEntries,
  COMMANDS_FACE,
  COMPOSER_FACE,
  type ComposerEntries,
  type LauncherEntries,
  LAUNCHERS_FACE,
  PANES_FACE,
  type ResultEntries,
  RESULTS_FACE,
  type SectionEntries,
  type ShortcutEntries,
  SHORTCUTS_FACE,
  SURFACES_FACE,
  type ViewEntries,
  VIEWS_FACE,
} from '../wire/points.js';

export const VIEWS = new ContributionPoint<never, ViewEntries>('views/views', VIEWS_FACE);

export const RESULTS = new ContributionPoint<never, ResultEntries>('views/results', RESULTS_FACE);

export const COMPOSER = new ContributionPoint<never, ComposerEntries>('views/composer', COMPOSER_FACE);

export const SURFACES = new ContributionPoint<never, SectionEntries>('views/surfaces', SURFACES_FACE);

export const PANES = new ContributionPoint<never, SectionEntries>('views/panes', PANES_FACE);

export const LAUNCHERS = new ContributionPoint<never, LauncherEntries>('views/launchers', LAUNCHERS_FACE);

export const ACTIONS = new ContributionPoint<never, ActionEntries>('views/actions', ACTIONS_FACE);

export const SHORTCUTS = new ContributionPoint<never, ShortcutEntries>('views/shortcuts', SHORTCUTS_FACE);

export const COMMANDS = new ContributionPoint<never, CommandEntries>('views/commands', COMMANDS_FACE);
