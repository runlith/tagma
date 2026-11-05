import type { AppBindings, AppFeed, AppGlobal } from './appFeed';
import { PageActions } from './PageActions';
import { pagingMargin } from './reach';
import type { StandGlobal, StandPort } from './port';
import { premeasure } from './premeasure';
import { Recorder, scroller } from './recorder';
import type { ObservedEntries, Recording } from './recording';

const page = globalThis as typeof globalThis & AppGlobal & StandGlobal;
const GROUP = /^(activity|notices|folded|thoughts):(.+)$/;
const LIVE = 'live:status';

function feed(): AppFeed {
  const current = page.feedApp;
  if (current === undefined) throw new Error('The app lane injected no seeded thread');
  return current;
}

function bound<K extends keyof AppBindings>(name: K): AppBindings[K] {
  const binding = page[name];
  if (binding === undefined) throw new Error(`The app lane exposed no ${name}`);
  return binding as AppBindings[K];
}

const entries: ObservedEntries = {
  get jump() {
    return feed().jump;
  },
  message(key) {
    const now = feed();
    if (key === LIVE) return now.labels[now.newest] ?? null;
    return now.labels[key.match(GROUP)?.[2] ?? key] ?? null;
  },
  kind(key) {
    if (key === LIVE) return 'status';
    if (key.startsWith('tail:')) return 'tail';
    return key.match(GROUP)?.[1] ?? feed().kinds[key] ?? 'unknown';
  },
  tail(key) {
    return key === feed().newest || key === LIVE || key.startsWith('tail:');
  },
};

function arrived(): boolean {
  const root = document.querySelector<HTMLElement>('[data-scrollable][role="group"]');
  if (root === null || root.clientHeight === 0) return false;
  for (const row of root.querySelectorAll<HTMLElement>('[data-timeline-key]'))
    if (entries.message(row.dataset.timelineKey!) !== null) return true;
  return false;
}

function whenArrived(then: () => void): void {
  if (arrived()) return then();
  const observer = new MutationObserver(() => {
    if (!arrived()) return;
    observer.disconnect();
    then();
  });
  observer.observe(document, { childList: true, subtree: true });
}

function install(): void {
  let recorder: Recorder | null = null;
  let recording: string | null = null;
  let requested = 0;
  let landed = 0;
  const held = (): Recorder => {
    if (recorder === null) throw new Error('The recorder is detached while the thread is away');
    return recorder;
  };
  const actions = new PageActions(held, entries, pagingMargin);
  const attach = () => {
    recorder?.dispose();
    recorder = new Recorder(entries);
    if (recording !== null) recorder.start(recording);
    port.ready = true;
  };
  const port: StandPort = {
    ready: false,
    async remount() {
      held().dispose();
      recorder = null;
      port.ready = false;
      await bound('feedAppLeave')();
      const back = new Promise<void>((resolve) =>
        whenArrived(() => {
          attach();
          resolve();
        }),
      );
      await bound('feedAppReturn')();
      await back;
    },
    point: () => actions.point(),
    targets: () => held().targets(),
    scrollbar: () => actions.scrollbar(),
    position: (top) => actions.position(top),
    async approach(distance) {
      if (actions.head() === feed().head) throw new Error('No older app page remains before positioning');
      await actions.approach(distance, async () => (await bound('feedAppPaging')()).requested);
    },
    positionDisclosure: (side) => actions.positionDisclosure(side),
    disclosurePoint: () => actions.disclosurePoint(),
    async warm(reach) {
      const recorder = held();
      recorder.start('control-warmup');
      const control = await premeasure(recorder, reach);
      recorder.stop();
      return control;
    },
    start(name) {
      actions.start(async () => (await bound('feedAppPaging')()).requested);
      recording = name;
      held().start(name);
    },
    beginDrag: (distance, speed, preventFling, quantum) => {
      actions.input();
      held().beginDrag(distance, speed, preventFling, quantum);
    },
    endDrag: () => held().endDrag(),
    beginWheel: () => {
      actions.input();
      held().beginWheel();
    },
    endWheel: () => held().endWheel(),
    pressed: () => held().pressed(),
    released: () => held().released(),
    wheelSettled: () => held().wheelSettled(),
    landed: () => held().landed(),
    stop(): Recording {
      recording = null;
      return held().stop();
    },
    frames: (count) => held().frames(count),
    frameTime: () => held().frameTime(),
    async stream(chunks = 24) {
      page.feedApp = await bound('feedAppStream')(chunks);
    },
    async loadOlder() {
      const before = actions.baseline();
      if (before === feed().head) {
        const root = scroller();
        console.warn(
          `feed app lane: the rail already starts at ${before}; no older page remains, the reader at scrollTop ${root.scrollTop} of ${root.scrollHeight}`,
        );
        return false;
      }
      const paging = async () => (await bound('feedAppPaging')()).requested;
      if (!(await actions.loadOlder(paging))) return false;
      requested = await paging();
      landed += 1;
      return true;
    },
    reachOlder: () => actions.reachOlder(),
    pageLatency() {},
    holdPages() {
      throw new Error('The app lane serves real pages and exposes no page gate for a held drag');
    },
    releasePages() {
      throw new Error('The app lane serves real pages and exposes no page gate for a held drag');
    },
    paging: () => ({ requested, landed, latency: 0 }),
    async resize(width, height) {
      await bound('feedAppResize')(width, height);
      await held().frames(2);
    },
    changed: () => held().changed(),
    state() {
      const root = scroller();
      return { top: root.scrollTop, height: root.scrollHeight, viewport: root.clientHeight };
    },
  };
  page.feedStand = port;
  whenArrived(() => {
    if (feed().opening) recording = 'opening';
    attach();
  });
}

if (window.top === window) install();
