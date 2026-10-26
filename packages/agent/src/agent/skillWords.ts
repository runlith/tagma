import type { ToolWords } from '../tool/words';

export const LOAD_SKILL_TOOL = 'load_skill';

export const SKILL_WORDS = {
  [LOAD_SKILL_TOOL]: {
    running: 'Loading skill',
    runningAlone: 'Loading a skill',
    done: 'Loaded skill',
    doneAlone: 'Loaded a skill',
    many: (count) => `Loaded ${count} skills`,
  },
} satisfies Record<string, ToolWords>;
