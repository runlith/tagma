import type { Installed, Installing, MachineAct, NextOffer, NextStanding, NextStep, Said } from '../installation/contract/wire/next.js';
import type { BuildEnded, BuildFrom, BuildRunning, BuildStep, CheckoutState } from './record.js';

const counted = (count: number, one: string, many = `${one}s`): string => `${count} ${count === 1 ? one : many}`;

const plain = (text: string): Said => ({ text, strong: false });
const strong = (text: string): Said => ({ text, strong: true });

export const TITLES: Readonly<Record<BuildFrom, string>> = {
  head: 'Latest commit',
  tree: 'Working tree',
  back: 'Previous installation',
};

const STEPS: Readonly<Record<'prepare' | 'build' | 'back' | 'restart', NextStep>> = {
  prepare: { id: 'prepare', title: 'Prepare', weight: 2.5 },
  build: { id: 'build', title: 'Build', weight: 5 },
  back: { id: 'back', title: 'Step back', weight: 1 },
  restart: { id: 'restart', title: 'Restart', weight: 1.5 },
};

const STAGE: Readonly<Record<BuildStep, keyof typeof STEPS>> = {
  worktree: 'prepare',
  install: 'prepare',
  build: 'build',
  back: 'back',
  restart: 'restart',
};

const stepsOf = (from: BuildFrom, restarts: boolean): readonly NextStep[] => [
  ...(from === 'head' ? [STEPS.prepare, STEPS.build] : from === 'tree' ? [STEPS.build] : [STEPS.back]),
  ...(restarts ? [STEPS.restart] : []),
];

export const standingOf = (checkout: CheckoutState | null): NextStanding => {
  if (checkout === null)
    return { tone: 'alone', said: [plain('Installed release · there is no checkout here to build from')], behind: null };
  const name = strong(checkout.path.split('/').pop() ?? checkout.path);
  const files = (count: number, what = 'file') => strong(counted(count, what));
  switch (checkout.runs) {
    case 'tree':
      return {
        tone: 'latest',
        said:
          checkout.changed > 0
            ? [plain('Running everything in '), name, plain(', uncommitted included')]
            : [plain('Running the latest commit of '), name],
        behind: null,
      };
    case 'head':
      return {
        tone: 'behind',
        said: [plain('Running the latest commit · '), files(checkout.changed, 'uncommitted file'), plain(' not in it')],
        behind: null,
      };
    case 'other-edits':
      return {
        tone: 'apart',
        said:
          checkout.changed === 0
            ? [plain('Running '), name, plain('’s HEAD with changes no longer on disk')]
            : [plain('Running '), name, plain('’s HEAD with older changes · '), files(checkout.changed), plain(' changed since')],
        behind: null,
      };
    case 'unmeasured-edits':
      return {
        tone: 'apart',
        said: [plain('Running '), name, plain('’s HEAD with uncommitted changes · the tree may differ')],
        behind: null,
      };
    case 'other-commit': {
      const ahead = checkout.ahead ?? 0;
      return {
        tone: ahead > 0 ? 'behind' : 'apart',
        said: [
          name,
          ...(ahead > 0
            ? [plain(' is '), strong(counted(ahead, 'commit')), plain(' ahead of this build')]
            : [plain(' stands on another commit than this build')]),
          ...(checkout.changed > 0 ? [plain(' · '), files(checkout.changed), plain(' uncommitted')] : []),
        ],
        behind: ahead > 0 ? counted(ahead, 'commit') : null,
        behindBy: ahead > 0 ? ahead : undefined,
      };
    }
    case null:
      return {
        tone: 'apart',
        said: [
          name,
          plain(` · ${checkout.head ?? 'no commit'}`),
          ...(checkout.changed > 0 ? [plain(' · '), files(checkout.changed), plain(' uncommitted')] : []),
        ],
        behind: null,
      };
  }
};

export const offersOf = (checkout: CheckoutState | null, denied: string | null): readonly NextOffer[] => {
  if (checkout === null) return [];
  const headless = denied ?? (checkout.head === null ? 'This folder has no commit to build' : null);
  const clean = checkout.changed === 0;
  return [
    {
      id: 'head',
      title: TITLES.head,
      detail: checkout.subject ?? checkout.head ?? 'no commit',
      label: checkout.head?.slice(0, 7) ?? '',
      size: null,
      irreversible: null,
      current: checkout.runs === 'head' || (checkout.runs === 'tree' && checkout.changed === 0),
      disabled: headless,
      why: denied === null && checkout.head === null ? 'not a git checkout: no HEAD to cut' : null,
      update: 'tagma update --head',
      install: 'tagma build --head',
    },
    {
      id: 'tree',
      title: TITLES.tree,
      size: null,
      irreversible: null,
      update: 'tagma update --tree',
      install: 'tagma build --tree',
      detail:
        checkout.changed === 0
          ? 'Nothing uncommitted: same as the commit'
          : checkout.runs === 'unmeasured-edits'
            ? 'The commit plus everything uncommitted · may differ from what runs'
            : 'The commit plus everything uncommitted',
      label: checkout.changed > 0 ? `+${counted(checkout.changed, 'file')}` : '',
      current: checkout.runs === 'tree' && checkout.changed > 0,
      disabled: denied ?? (clean ? 'Nothing uncommitted: the latest commit is the same' : null),
      why: denied === null && clean ? 'nothing uncommitted: the latest commit is the same tree' : null,
    },
  ];
};

const newerOf = (checkout: CheckoutState): BuildFrom | null => {
  switch (checkout.runs) {
    case 'head':
    case 'unmeasured-edits':
      return checkout.changed > 0 ? 'tree' : null;
    case 'other-edits':
      return checkout.changed > 0 ? 'tree' : 'head';
    case 'other-commit':
      return (checkout.ahead ?? 0) === 0 ? null : checkout.changed > 0 ? 'tree' : 'head';
    case 'tree':
    case null:
      return null;
  }
};

export const updateOf = (checkout: CheckoutState | null, denied: string | null): string | null => {
  if (checkout === null || denied !== null) return null;
  const newer = newerOf(checkout);
  return newer === 'head' && checkout.head === null ? null : newer;
};

export const backOf = (checkout: CheckoutState | null, previous: string | null, denied: string | null): NextOffer | null =>
  checkout === null
    ? null
    : {
        id: 'back',
        title: TITLES.back,
        detail: 'The installation kept beside the one that stands; the server restarts onto it',
        label: previous ?? '',
        size: null,
        irreversible: null,
        current: false,
        disabled: denied ?? (previous === null ? 'No earlier installation is kept to go back to' : null),
        why: denied === null && previous === null ? 'no installation is kept beside the one that stands' : null,
        update: 'tagma update --back',
        install: 'tagma update --back',
      };

export const actsOf = (running: BuildRunning | null): readonly MachineAct[] => [
  {
    act: 'stop',
    command: 'tagma build --stop',
    disabled: running === null ? 'nothing is installing' : running.step === 'restart' ? 'it landed and the restart is asked' : null,
  },
];

export const installingOf = (running: BuildRunning): Installing => ({
  offer: running.from,
  title: TITLES[running.from],
  target: running.revision,
  since: running.since,
  log: running.log,
  then: running.then,
  steps: stepsOf(running.from, running.then === 'restart'),
  step: STAGE[running.step],
  progress: null,
  tail: running.tail,
  usually: running.usually,
});

export const installedOf = (ended: BuildEnded): Installed => ({
  offer: ended.from,
  title: TITLES[ended.from],
  target: ended.revision,
  outcome: ended.outcome,
  build: ended.build,
  detail: ended.detail,
  endedAt: ended.endedAt,
  log: ended.log,
  since: ended.since,
  tail: ended.tail,
  then: ended.then,
  restartRefused: ended.restartRefused,
  refused: ended.refused,
});
