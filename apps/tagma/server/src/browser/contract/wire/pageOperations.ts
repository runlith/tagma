import { placedCursor } from '../../../platform/contract/wire/place.js';
import { Schema } from 'effect';
import { arms, operation } from '../../../platform/contract/wire/operation.js';
import { ceilingOf, limitOf } from '../../../platform/contract/wire/pageFamily.js';
import { Cpu, DEVICE_NAMES, Emulation, Geolocation, NetworkCondition, SCHEMES, Viewport } from './emulation.js';
import { PageId, ProfileId, Ref } from './ids.js';
import { HEAP_CLASSES, HeapCaptured } from './heap.js';
import { Download, Glance, Page } from './page.js';
import {
  CONSOLE_LEVELS,
  CONSOLE_ROWS,
  CONSOLE_STACK_ROWS,
  ConsoleEntry,
  DOWNLOAD_ROWS,
  NETWORK_ROWS,
  NetworkEntry,
  PAGE_ROWS,
  SNAPSHOT_LINES,
} from './rows.js';
import { ACTING, DRIVE_REFUSALS, page, PAGE_REFUSALS, project, READING } from './shape.js';

export const ACTIONS = [
  'click',
  'double-click',
  'hover',
  'fill',
  'type',
  'press',
  'select',
  'check',
  'uncheck',
  'scroll',
  'drag',
  'upload',
  'focus',
] as const;
export type ActionName = (typeof ACTIONS)[number];

export const CAPTURES = ['viewport', 'full', 'element', 'pdf', 'heap'] as const;

export const WAITS = ['load', 'text', 'url', 'element'] as const;

export const GOES = ['back', 'forward', 'reload', 'stop'] as const;

const Point = { x: Schema.optional(Schema.Finite), y: Schema.optional(Schema.Finite) };

export const ActionStep = Schema.Struct({
  action: Schema.Literals(ACTIONS),
  ref: Schema.optional(Ref),
  ...Point,
  text: Schema.optional(Schema.String),
  key: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
  values: Schema.optional(Schema.Array(Schema.String)),
  to: Schema.optional(Schema.Struct({ ref: Schema.optional(Ref), ...Point })),
  dx: Schema.optional(Schema.Finite),
  dy: Schema.optional(Schema.Finite),
  files: Schema.optional(Schema.Array(Schema.String.check(Schema.isMinLength(1)))),
});
export type ActionStep = typeof ActionStep.Type;

export const ActionRun = Schema.Struct({
  page: Glance,
  completed: Schema.Int,
  stopped: Schema.NullOr(Schema.Int),
});
export type ActionRun = typeof ActionRun.Type;

export const WAIT_CEILING_MS = 120_000;

export const PAGE_OPERATIONS = {
  open_page: operation('open_page', {
    ...ACTING,
    tool: { ...ACTING.tool, companions: ['snapshot_page', 'capture_page'] },
    meaning: 'Open a page of the browser built into Tagma in this project and answer its id and state.',
    grammar:
      'Without `profile` a thread opens in the `browser.agentProfile` setting and the operator in `browser.userProfile`. A profile whose host is not connected refuses `host-away` naming the profiles of connected hosts; nothing is opened in another profile instead. The page this call opens becomes the page this thread works with by default.',
    input: Schema.Struct({
      project,
      url: Schema.optional(Schema.String.check(Schema.isMinLength(1))).annotate({
        description: 'The address to load; omitted, a blank page.',
      }),
      profile: Schema.optional(ProfileId).annotate({ description: 'The profile id list_profiles answered.' }),
    }),
    answer: arms({ opened: { page: Page } }),
    refusals: [...DRIVE_REFUSALS, 'navigation-failed', 'operator-input'],
    confirmation: () => ({ summary: 'Open a page?' }),
    confirmLabel: 'Open page',
    presentation: { running: 'Opening a page', done: 'Opened a page' },
  }),
  close_page: operation('close_page', {
    ...ACTING,
    meaning:
      'Close a page; it joins the last twenty closed pages of this project. A page that asks to stay opens its leave dialog, and the close waits for answer_page_dialog: accepted, it closes; dismissed, it stays open and the close refuses page-stayed.',
    input: Schema.Struct({ project, page }),
    answer: arms({ closed: { page: PageId } }),
    refusals: ['page-unknown', 'page-stayed', 'host-away', 'host-refused', 'outcome-unknown'],
    confirmation: () => ({ summary: 'Close the page?' }),
    confirmLabel: 'Close page',
    presentation: { running: 'Closing the page', done: 'Closed the page' },
  }),
  list_pages: operation('list_pages', {
    ...READING,
    meaning:
      'List the open pages of this project, most recently active first, each with its address, title, profile, state and live state.',
    grammar:
      '`state` is `live` while a connected host holds the page, `dormant` while its host is connected without it (it is restored on the next show or act), `away` while its host is gone. `closed` lists the last twenty closed pages instead. A page of rows with the total; `next` continues the walk.',
    input: Schema.Struct({ project, closed: Schema.optional(Schema.Boolean), limit: limitOf(PAGE_ROWS), cursor: placedCursor }),
    answer: arms({ listed: { pages: Schema.Array(Page), shown: Schema.Int, total: Schema.Int, next: Schema.NullOr(Schema.String) } }),
    refusals: ['bad-cursor', 'cursor-stale'],
    page: PAGE_ROWS,
    confirmation: () => ({ summary: 'List the pages?' }),
    confirmLabel: 'List pages',
    presentation: { running: 'Listing the pages', done: 'Listed the pages' },
  }),
  navigate_page: operation('navigate_page', {
    ...ACTING,
    meaning: 'Load an address in a page, or go back, forward, reload or stop.',
    grammar:
      'Name `url` or `go`. The answer comes once committed, before load; wait_for_page with `load` waits for that. A network failure refuses `navigation-failed`. Agent navigation, including open_page, actions, frames, redirects and popups, follows browser.blockedDomains and browser.allowedDomains: project lists replace user lists, blocked wins, both empty leave navigation unrestricted. A blocked HTTP(S) document never loads and refuses domain-blocked naming its domain and setting; a block after a completed call is surfaced once at the next agent action. Operator input or navigation lifts the policy. Non-network documents (blob/data/about) and page subresources/fetches are outside these lists. While a restricted managed page exists, other HTTP(S) documents in that profile pass through interception too; workers are untouched.',
    input: Schema.Struct({
      project,
      page,
      url: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
      go: Schema.optional(Schema.Literals(GOES)),
    }),
    answer: arms({ navigated: { page: Glance } }),
    refusals: [...DRIVE_REFUSALS, 'navigation-failed', 'action-shape', 'operator-input'],
    confirmation: (input) => ({ summary: input.url === undefined ? `Go ${input.go ?? 'nowhere'}?` : `Open ${input.url}?` }),
    confirmLabel: 'Navigate',
    presentation: { running: 'Navigating', done: 'Navigated' },
  }),
  snapshot_page: operation('snapshot_page', {
    ...READING,
    meaning:
      'Read a page as its accessibility tree in compact text, the main frame and its frames, each element with a reference like `e12` that act_on_page takes.',
    grammar:
      'A node keeps the same reference in every later snapshot of the same document; a reference from a document that has since been replaced refuses `stale-ref`. `within` reads the subtree under one reference. The tree is read only as far as `limit` lines; `more` says it goes on past them — read a part with `within`.',
    input: Schema.Struct({ project, page, within: Schema.optional(Ref), limit: limitOf(SNAPSHOT_LINES) }),
    answer: arms({ snapshot: { page: Glance, text: Schema.String, shown: Schema.Int, more: Schema.Boolean } }),
    refusals: [...DRIVE_REFUSALS, 'stale-ref'],
    confirmation: () => ({ summary: 'Read the page?' }),
    confirmLabel: 'Snapshot page',
    presentation: { running: 'Reading the page', done: 'Read the page' },
  }),
  act_on_page: operation('act_on_page', {
    ...ACTING,
    meaning:
      'Run an ordered sequence of browser actions: click, double-click, hover, fill, type, press, select, check, uncheck, scroll, drag, upload or focus.',
    grammar:
      'Send `steps`, a nonempty list; one action is a one-item list. The sequence holds the page queue once, so other calls cannot interleave. It stops at the first refusal or opened dialog, without undoing earlier steps. A refusal keeps its code and recovery guidance; its reason names the 1-based stopping step and how many steps completed. Otherwise `completed` counts finished steps and `stopped` names the 1-based step that opened the dialog in `page`, or is null. The stopping step may have had effects; an unknown outcome is not retried. Aim with `ref` from a snapshot or viewport `x`/`y` in CSS pixels. A click scrolls the element into view and refuses `element-obscured` if covered. `fill` replaces with `text`; `type` inserts at the caret; `press` takes `key` like Enter, Tab, Control+A or a typed character; `select` takes `values` or labels; `scroll` takes `dx`/`dy` or a `ref` to reveal; `drag` goes to `to`; `upload` takes checkout `files`. In human mode, upload clicks a visible file-chooser control and supplies files only after its chooser opens; select uses the keyboard for a single native choice or clicks an accessible custom listbox option. Input never takes the operator’s screen focus. While the operator works the page with their own input, each step refuses `operator-input` until that input has been quiet a few seconds; a step already running finishes. The answer carries the final page state.',
    input: Schema.Struct({ project, page, steps: Schema.NonEmptyArray(ActionStep) }),
    answer: arms({ acted: ActionRun.fields }),
    refusals: [...DRIVE_REFUSALS, 'stale-ref', 'element-obscured', 'action-shape', 'operator-input'],
    confirmation: (input) => ({ summary: `Run ${input.steps.length} steps on the page?` }),
    confirmLabel: 'Act on page',
    presentation: { running: 'Acting on the page', done: 'Acted on the page' },
  }),
  emulate_page: operation('emulate_page', {
    ...ACTING,
    meaning: 'Set or clear a page’s viewport, device, color scheme, CPU slowdown, network conditions and geolocation.',
    grammar:
      '`device` sets size, pixel ratio, mobile mode and user agent; `viewport` sets size alone; `scheme` sets `prefers-color-scheme`. Those overrides survive reconnection. `cpu` is a factor from 1 to 20 (1 removes slowdown), including other-process frames; pages sharing its renderer slow too. Desktop CPU watchdog strain follows exact renderer processes, widening to the profile only during pending navigation toward an unknown speculative renderer and returning on commit or failure. Managed watchdogs and engine frame probes without renderer identity use profile scope, delaying detection of a genuinely hung sibling until strain ends. `network` takes offline, slow-3g, fast-3g, slow-4g or fast-4g, or latency in ms and download/upload in bytes per second; null removes it. Throttling leaves navigator.connection unchanged; offline also changes navigator.onLine. `geolocation` takes latitude, longitude and optional accuracy in metres; null removes it. On the managed host its permission grant reaches same-origin pages of the profile. Conditions end with the setting thread’s run or the engine session. `conditions: false` removes only these conditions; `clear` removes all overrides.',
    input: Schema.Struct({
      project,
      page,
      viewport: Schema.optional(Viewport),
      device: Schema.optional(Schema.Literals(DEVICE_NAMES)),
      scheme: Schema.optional(Schema.Literals(SCHEMES)),
      cpu: Schema.optional(Cpu),
      network: Schema.optional(Schema.NullOr(NetworkCondition)),
      geolocation: Schema.optional(Schema.NullOr(Geolocation)),
      conditions: Schema.optional(Schema.Literal(false)),
      clear: Schema.optional(Schema.Boolean),
    }),
    answer: arms({ emulated: { page: Glance, emulation: Emulation } }),
    refusals: [...DRIVE_REFUSALS, 'operator-input'],
    confirmation: () => ({ summary: 'Change how the page is rendered?' }),
    confirmLabel: 'Emulate',
    presentation: { running: 'Emulating', done: 'Emulated' },
  }),
  capture_page: operation('capture_page', {
    ...ACTING,
    meaning: 'Capture a page as a picture, PDF or heap snapshot; the local file is kept and named in the answer.',
    grammar:
      'A picture up to 5 MiB reaches the agent as an image; a larger one stays file-only. `element` takes `ref`. `heap` pauses the main frame’s V8 isolate and writes a .heapsnapshot that Chrome DevTools opens; other-process frames are outside it and same-isolate pages can appear. It summarizes self size, object count, detached native nodes, the largest classes and growth against this page’s previous capture, each list bounded by `limit`. `pausedMs` measures the capture’s pause hold, an upper bound on the renderer pause. An admitted capture waits for its producer even after caller cancellation or a chunk-write failure. Managed watchdogs and unknown-identity engine frame probes pause for the profile, so a genuinely hung sibling is detected only after capture ends. Desktop heap pause stays on the captured PID; concurrent CPU strain widens to the profile only during navigation toward an unknown speculative renderer and returns to exact membership on commit or failure. Heap files contain all heap strings, including sign-in tokens; only class names enter the answer. The newest four heap files stay per page; `removed` names any pruned files.',
    input: Schema.Struct({
      project,
      page,
      what: Schema.optional(Schema.Literals(CAPTURES)),
      ref: Schema.optional(Ref),
      limit: limitOf(HEAP_CLASSES),
    }),
    answer: arms({
      captured: {
        page: Glance,
        path: Schema.String,
        mediaType: Schema.String,
        bytes: Schema.Int,
        width: Schema.NullOr(Schema.Int),
        height: Schema.NullOr(Schema.Int),
      },
      heap: HeapCaptured.fields,
    }),
    refusals: [...DRIVE_REFUSALS, 'stale-ref', 'action-shape', 'heap-failed'],
    confirmation: () => ({ summary: 'Capture the page?' }),
    confirmLabel: 'Capture page',
    presentation: { running: 'Capturing the page', done: 'Captured the page' },
  }),
  evaluate_in_page: operation('evaluate_in_page', {
    ...ACTING,
    meaning: "Evaluate a JavaScript expression in the page's own top frame and answer its value as JSON.",
    grammar: `A promise is awaited. A value past ${40_000} characters of JSON is cut. An exception answers \`thrown\` with its text. The page sees what the expression does.`,
    input: Schema.Struct({ project, page, expression: Schema.String.check(Schema.isMinLength(1)) }),
    answer: arms({
      evaluated: { page: Glance, value: Schema.String, cut: Schema.Boolean },
      thrown: { page: Glance, exception: Schema.String },
    }),
    refusals: [...DRIVE_REFUSALS, 'operator-input'],
    confirmation: () => ({ summary: 'Run this in the page?' }),
    confirmLabel: 'Evaluate',
    presentation: { running: 'Evaluating in the page', done: 'Evaluated in the page' },
  }),
  wait_for_page: operation('wait_for_page', {
    ...READING,
    meaning: 'Wait until a page has loaded, shows a text, reaches an address or holds an element, within the time named.',
    grammar:
      '`load` waits for the load of the current document; `text` for the text anywhere in the page; `url` for an address containing `value`; `element` for a CSS selector matching a visible element. Past `timeoutMs` it refuses `wait-unmet` with what it saw.',
    input: Schema.Struct({
      project,
      page,
      until: Schema.Literals(WAITS),
      value: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
      timeoutMs: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: WAIT_CEILING_MS })).annotate({
        description: `How long to wait, at most ${WAIT_CEILING_MS} ms.`,
      }),
    }),
    answer: arms({ met: { page: Glance, waitedMs: Schema.Int } }),
    refusals: [...DRIVE_REFUSALS, 'wait-unmet', 'action-shape'],
    confirmation: () => ({ summary: 'Wait for the page?' }),
    confirmLabel: 'Wait',
    presentation: { running: 'Waiting for the page', done: 'Waited for the page' },
  }),
  read_page_console: operation('read_page_console', {
    ...READING,
    meaning: 'Read the console messages and exceptions of a page, newest last, with the total held.',
    grammar:
      'Capture follows the profile: `auto` on loopback and private-network pages, and on any page from its first console read on; `always`; `never` refuses `console-off`. Text reads as the DevTools console shows it: objects from their previews, format specifiers applied; a message logged before capture began shows objects by class name. `level` keeps that level and more severe ones; `match` keeps entries whose text or address holds it; `after` reads past a `seq` already seen. `dropped` counts entries the buffer let go.',
    input: Schema.Struct({
      project,
      page,
      level: Schema.optional(Schema.Literals(CONSOLE_LEVELS)),
      match: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
      after: Schema.optional(Schema.Int),
      limit: limitOf(CONSOLE_ROWS),
      seq: Schema.optional(Schema.Int).annotate({ description: 'Answer only the entry with this `seq`, whatever the filters.' }),
      stack: Schema.optional(Schema.Boolean).annotate({
        description: `Add each entry's stack; such a read answers ${CONSOLE_STACK_ROWS.defaultRows} rows by default and ${ceilingOf(CONSOLE_STACK_ROWS)} at most.`,
      }),
    }),
    answer: arms({
      read: {
        page: PageId,
        entries: Schema.Array(ConsoleEntry),
        shown: Schema.Int,
        total: Schema.Int,
        dropped: Schema.Int,
        capturing: Schema.Boolean,
        conditions: Schema.NullOr(Schema.String),
      },
    }),
    refusals: [...DRIVE_REFUSALS, 'console-off'],
    page: CONSOLE_ROWS,
    confirmation: () => ({ summary: 'Read the console?' }),
    confirmLabel: 'Read console',
    presentation: { running: 'Reading the console', done: 'Read the console' },
  }),
  read_page_network: operation('read_page_network', {
    ...READING,
    meaning: 'Read the requests of a page, newest last, with the total held, or the body of one response.',
    grammar:
      '`match` keeps requests whose address holds it; `failed` keeps failed requests and responses with status 400 or more; `after` reads past a `seq` already seen. `body` names a request and answers its response body, cut past 40 000 characters, while the page keeps it.',
    input: Schema.Struct({
      project,
      page,
      match: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
      failed: Schema.optional(Schema.Boolean),
      after: Schema.optional(Schema.Int),
      limit: limitOf(NETWORK_ROWS),
      body: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
    }),
    answer: arms({
      read: {
        page: PageId,
        requests: Schema.Array(NetworkEntry),
        shown: Schema.Int,
        total: Schema.Int,
        dropped: Schema.Int,
        conditions: Schema.NullOr(Schema.String),
      },
      body: {
        page: PageId,
        request: Schema.String,
        body: Schema.String,
        base64: Schema.Boolean,
        cut: Schema.Boolean,
        conditions: Schema.NullOr(Schema.String),
      },
    }),
    refusals: [...DRIVE_REFUSALS, 'body-unavailable'],
    page: NETWORK_ROWS,
    confirmation: () => ({ summary: 'Read the network?' }),
    confirmLabel: 'Read network',
    presentation: { running: 'Reading the network', done: 'Read the network' },
  }),
  read_page_downloads: operation('read_page_downloads', {
    ...READING,
    meaning: 'List the downloads of a page, newest first, with their file, size and state; a finished file is read at its path.',
    grammar: 'The page keeps its last 50 downloads; `limit` reads the newest of them and `total` counts what it keeps.',
    input: Schema.Struct({ project, page, limit: limitOf(DOWNLOAD_ROWS) }),
    answer: arms({
      read: {
        page: PageId,
        downloads: Schema.Array(Download),
        shown: Schema.Int,
        total: Schema.Int,
        conditions: Schema.NullOr(Schema.String),
      },
    }),
    refusals: ['page-unknown'],
    page: DOWNLOAD_ROWS,
    confirmation: () => ({ summary: 'List the downloads?' }),
    confirmLabel: 'List downloads',
    presentation: { running: 'Listing the downloads', done: 'Listed the downloads' },
  }),
  answer_page_dialog: operation('answer_page_dialog', {
    ...ACTING,
    meaning: 'Answer the alert, confirm, prompt or leave-page dialog open on a page.',
    grammar:
      '`accept` false dismisses it; `text` answers a prompt. While a dialog is open, every other action on the page refuses `dialog-open`.',
    input: Schema.Struct({ project, page, accept: Schema.Boolean, text: Schema.optional(Schema.String) }),
    answer: arms({ answered: { page: Glance } }),
    refusals: [...DRIVE_REFUSALS, 'no-dialog'],
    confirmation: (input) => ({ summary: input.accept ? 'Accept the dialog?' : 'Dismiss the dialog?' }),
    confirmLabel: 'Answer dialog',
    presentation: { running: 'Answering the dialog', done: 'Answered the dialog' },
  }),
};

export type PageOperationId = keyof typeof PAGE_OPERATIONS;
