import { Schema } from 'effect';
import type {
  Installed,
  Installing,
  MachineAct,
  NextFrame,
  NextIssue,
  NextOffer,
  NextStanding,
  NextStep,
  Said,
} from '../installation/contract/wire/next.js';
import { IRREVERSIBLE_STORES, type IrreversibleChange } from '../installation/contract/wire/manifest.js';
import { compareReleases, type Feed, type FeedRelease, isRelease, newestOf } from '../installation/contract/wire/feed.js';
import { crossesNoWayBack, newerThan, type ReleaseChoice } from './feed.js';

export const BACK = 'back';
export const RELEASE_TITLE = 'Release';
export const BACK_TITLE = 'Previous release';

export const STEPS = {
  download: { id: 'download', title: 'Download', weight: 6 },
  verify: { id: 'verify', title: 'Verify', weight: 0.5 },
  install: { id: 'install', title: 'Install', weight: 2 },
  back: { id: 'back', title: 'Step back', weight: 1 },
  restart: { id: 'restart', title: 'Restart', weight: 1.5 },
} as const satisfies Record<string, NextStep>;

export type StepId = keyof typeof STEPS;

export const stepsOf = (back: boolean, restarts: boolean): readonly NextStep[] => [
  ...(back ? [STEPS.back] : [STEPS.download, STEPS.verify, STEPS.install]),
  ...(restarts ? [STEPS.restart] : []),
];

export type Previous = {
  readonly version: string;
  readonly root: string;
  readonly build: string | null;
  readonly refused: { readonly said: string; readonly why: string } | null;
};

export const backRefused = {
  unreadable: (version: string, why: string) => ({ said: `Tagma ${version} is damaged and cannot be started again`, why }),
  unreadableData: (version: string, why: string) => ({
    said: `Tagma ${version} cannot read your data as this version left it, so there is no way back to it`,
    why,
  }),
} as const;

export type ChannelState = {
  readonly instance: string;
  readonly revision: number;
  readonly readAt: string;
  readonly readFrom: string | null;
  readonly feed: Feed | null;
  readonly issue: NextIssue | null;
  readonly choice: ReleaseChoice;
  readonly running: string;
  readonly previous: Previous | null;
  readonly installing: Installing | null;
  readonly installed: Installed | null;
  readonly history: string | null;
};

const plain = (text: string): Said => ({ text, strong: false });
const strong = (text: string): Said => ({ text, strong: true });
const counted = (count: number, one: string): string => `${count} ${count === 1 ? one : `${one}s`}`;

const STORES: Readonly<Record<(typeof IRREVERSIBLE_STORES)[number], string>> = {
  'machine-store': "this machine's store",
  'host-store': "the execution host's store",
  graph: 'the graph format',
  journal: 'the thread journal shape',
};

const knownStore = Schema.is(Schema.Literals(IRREVERSIBLE_STORES));

const storeText = (store: string): string => (knownStore(store) ? STORES[store] : store);

export const noWayBackTo = (changes: readonly IrreversibleChange[], previous: string, running: string): string | null => {
  const crossed = changes.filter((one) => !isRelease(previous) || !isRelease(one.release) || compareReleases(one.release, previous) > 0);
  if (crossed.length === 0) return null;
  const what = crossed.map((one) => `${storeText(one.store)} in ${one.release}`).join(', ');
  return `${running} carries changes ${previous} cannot read (${what}), so there is no way back to it`;
};

const TROUBLE: Readonly<Record<NextIssue['code'], string>> = {
  offline: ' · offline: updates cannot be checked',
  'source-unreadable': ' · updates cannot be read right now',
  'platform-unavailable': ' · no update for this machine',
};

const standingOf = (state: ChannelState, newer: readonly FeedRelease[]): NextStanding => {
  const said = settled(state, newer);
  return state.issue === null ? said : { ...said, said: [...said.said, plain(TROUBLE[state.issue.code])] };
};

const settled = (state: ChannelState, newer: readonly FeedRelease[]): NextStanding => {
  const { feed, running } = state;
  if (feed === null) return { tone: 'alone', said: [plain('Release '), strong(running), plain(' · checking for updates')], behind: null };
  const newest = newestOf(feed);
  if (newer.length > 0) {
    return {
      tone: 'behind',
      said: [plain('Release '), strong(newest.release), plain(' is out · this is '), strong(running)],
      behind: counted(newer.length, 'release'),
      behindBy: newer.length,
    };
  }
  if (!isRelease(running) || running !== newest.release) {
    return {
      tone: 'apart',
      said: [plain('Running '), strong(running), plain(` · the newest is ${newest.release}`)],
      behind: null,
    };
  }
  return { tone: 'latest', said: [plain('Running release '), strong(running), plain(', the newest')], behind: null };
};

const offerOf = (state: ChannelState, newer: readonly FeedRelease[], denied: string | null): NextOffer | null => {
  const newest = newer[0];
  if (newest === undefined || state.feed === null || state.choice.release === null) return null;
  return {
    id: newest.release,
    title: RELEASE_TITLE,
    detail: [
      newer.length > 1 ? `the newest of ${newer.length} releases after ${state.running}` : `the release after ${state.running}`,
      state.history,
    ]
      .filter((one) => one !== null)
      .join('. '),
    label: newest.release,
    size: state.choice.release.size,
    irreversible: crossesNoWayBack(state.feed, state.running, newest.release),
    current: false,
    disabled: denied,
    why: null,
    update: 'tagma release update',
    install: 'tagma release update --no-restart',
  };
};

const backOf = (previous: Previous | null, denied: string | null): NextOffer | null =>
  previous === null
    ? null
    : {
        id: BACK,
        title: BACK_TITLE,
        detail: 'the version you had before; Tagma restarts onto it',
        label: previous.build ?? previous.version,
        size: null,
        irreversible: null,
        current: false,
        disabled: denied ?? previous.refused?.said ?? null,
        why: denied === null ? (previous.refused?.why ?? null) : null,
        update: 'tagma release back',
        install: 'tagma release back',
      };

const actsOf = (installing: Installing | null): readonly MachineAct[] => [
  {
    act: 'stop',
    command: 'tagma release update --stop',
    disabled:
      installing === null ? 'nothing is installing' : installing.step === STEPS.restart.id ? 'it landed and the restart is asked' : null,
  },
];

export const frameOf = (given: ChannelState): NextFrame => {
  const state = { ...given, issue: given.issue ?? given.choice.issue };
  const newer = state.feed === null ? [] : newerThan(state.feed, state.running);
  const denied = state.installing === null ? null : 'An update is being installed';
  const offer = offerOf(state, newer, denied);
  return {
    instance: state.instance,
    pid: process.pid,
    revision: state.revision,
    readAt: state.readAt,
    readFrom: state.readFrom,
    watched: true,
    issue: state.issue,
    standing: standingOf(state, newer),
    offers: offer === null ? [] : [offer],
    update: offer === null || denied !== null ? null : offer.id,
    back: backOf(state.previous, denied),
    installing: state.installing,
    installed: state.installed,
    acts: actsOf(state.installing),
  };
};
