import { checkoutWorld, commandDescription, keepWarm, keepWarmPings, startShare, toolOutputShare } from './settings.js';
import {
  compactionOverrides,
  compactionStrategy,
  compactionSummarizerRule,
  compactionSummarizers,
  compactionTrigger,
} from './compactionSettings.js';
import {
  contextFileNames,
  contextFilesEnabled,
  globalSkillsEnabled,
  ownSkillEnabled,
  projectSkillsEnabled,
  rescanPolicy,
  skillGlobalDirectories,
  skillProjectDirectories,
  skillsDisabled,
} from './sourceSettings.js';

export const NATIVE_SETTING_KEYS = [
  keepWarm,
  keepWarmPings,
  commandDescription,
  toolOutputShare,
  startShare,
  compactionStrategy,
  compactionTrigger,
  compactionOverrides,
  compactionSummarizerRule,
  compactionSummarizers,
  checkoutWorld,
  contextFilesEnabled,
  contextFileNames,
  projectSkillsEnabled,
  globalSkillsEnabled,
  skillProjectDirectories,
  skillGlobalDirectories,
  ownSkillEnabled,
  skillsDisabled,
  rescanPolicy,
] as const;

export const NATIVE_SETTING_SECTIONS = [
  {
    id: 'agent',
    order: 40,
    title: 'Agent',
    description: "How the embedded agent delegates work and reads a project's own instructions.",
  },
  { id: 'skills', order: 50, title: 'Skills', description: 'Where skills are discovered, and when the set is re-read.' },
] as const;
