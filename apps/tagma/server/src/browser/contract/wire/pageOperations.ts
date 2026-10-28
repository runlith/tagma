import { placedCursor } from '../../../platform/contract/wire/place.js';
import { Schema } from 'effect';
import { arms, operation } from '../../../platform/contract/wire/operation.js';
import { ceilingOf, limitOf } from '../../../platform/contract/wire/pageFamily.js';
import { DEVICE_NAMES, Emulation, SCHEMES, Viewport } from './emulation.js';
import { PageId, ProfileId, Ref } from './ids.js';
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

export const CAPTURES = ['viewport', 'full', 'element', 'pdf'] as const;

export const WAITS = ['load', 'text', 'url', 'element'] as const;

export const GOES = ['back', 'forward', 'reload', 'stop'] as const;

const Point = { x: Schema.optional(Schema.Finite), y: Schema.optional(Schema.Finite) };

export const WAIT_CEILING_MS = 120_000;

export const PAGE_OPERATIONS = {
  open_page: operation('open_page', {
    ...ACTING,
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
    refusals: [...DRIVE_REFUSALS, 'navigation-failed'],
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
      'Name `url` or `go`. The answer comes once the navigation is committed, before the page has loaded: wait_for_page with `load` waits for that. A failed navigation refuses `navigation-failed` with the network error code.',
    input: Schema.Struct({
      project,
      page,
      url: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
      go: Schema.optional(Schema.Literals(GOES)),
    }),
    answer: arms({ navigated: { page: Glance } }),
    refusals: [...DRIVE_REFUSALS, 'navigation-failed', 'action-shape'],
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
      'Act on a page as a person would: click, double-click, hover, fill, type, press a key, select, check, uncheck, scroll, drag, upload or focus.',
    grammar:
      'Aim with `ref` from a snapshot or with `x`/`y` in CSS pixels of the viewport. Before a click the element is scrolled into view, and a point covered by another element refuses `element-obscured` naming it. `fill` replaces the value with `text`; `type` inserts `text` at the caret; `press` takes `key` like `Enter`, `Tab` or `Control+A` (US layout); `select` takes option `values` or labels; `scroll` takes `dx`/`dy`, or scrolls `ref` into view; `drag` goes to `to`; `upload` sets `files`, paths in this checkout. Input never takes the focus of the operator’s screen. The answer carries the page as the action left it: its address, title, an opened dialog, and whether a navigation started.',
    input: Schema.Struct({
      project,
      page,
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
    }),
    answer: arms({ acted: { page: Glance } }),
    refusals: [...DRIVE_REFUSALS, 'stale-ref', 'element-obscured', 'action-shape'],
    confirmation: (input) => ({ summary: `${input.action} on the page?` }),
    confirmLabel: 'Act on page',
    presentation: { running: 'Acting on the page', done: 'Acted on the page' },
  }),
  emulate_page: operation('emulate_page', {
    ...ACTING,
    meaning: 'Set or clear the viewport size, device and color scheme a page is rendered with.',
    grammar:
      '`device` sets size, pixel ratio, mobile mode and user agent at once; `viewport` sets size alone; `scheme` sets `prefers-color-scheme`. `clear` removes every override. Emulation lasts until it is cleared, across reconnections.',
    input: Schema.Struct({
      project,
      page,
      viewport: Schema.optional(Viewport),
      device: Schema.optional(Schema.Literals(DEVICE_NAMES)),
      scheme: Schema.optional(Schema.Literals(SCHEMES)),
      clear: Schema.optional(Schema.Boolean),
    }),
    answer: arms({ emulated: { page: Glance, emulation: Emulation } }),
    refusals: [...DRIVE_REFUSALS],
    confirmation: () => ({ summary: 'Change how the page is rendered?' }),
    confirmLabel: 'Emulate',
    presentation: { running: 'Emulating', done: 'Emulated' },
  }),
  capture_page: operation('capture_page', {
    ...ACTING,
    meaning:
      'Capture a page as a picture — the visible part, the whole page or one element — or print it to PDF; the file is kept and named in the answer.',
    grammar:
      'A picture up to 5 MiB reaches the agent as an image; a larger one, as a whole tall page can be, is only the file. `element` takes `ref`. A PDF is a file to read.',
    input: Schema.Struct({ project, page, what: Schema.optional(Schema.Literals(CAPTURES)), ref: Schema.optional(Ref) }),
    answer: arms({
      captured: {
        page: Glance,
        path: Schema.String,
        mediaType: Schema.String,
        bytes: Schema.Int,
        width: Schema.NullOr(Schema.Int),
        height: Schema.NullOr(Schema.Int),
      },
    }),
    refusals: [...DRIVE_REFUSALS, 'stale-ref', 'action-shape'],
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
    refusals: [...DRIVE_REFUSALS],
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
      read: { page: PageId, requests: Schema.Array(NetworkEntry), shown: Schema.Int, total: Schema.Int, dropped: Schema.Int },
      body: { page: PageId, request: Schema.String, body: Schema.String, base64: Schema.Boolean, cut: Schema.Boolean },
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
    answer: arms({ read: { page: PageId, downloads: Schema.Array(Download), shown: Schema.Int, total: Schema.Int } }),
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
