import { mintCursor, type PageQuestion, pageRows, readCursor } from '@runlith/paging';
import { Effect } from 'effect';
import { body, type OperationPair, pair } from '../platform/contract/service/body.js';
import type { Caller } from '../platform/contract/wire/caller.js';
import { ceilingOf } from '../platform/contract/wire/pageFamily.js';
import { saidLines } from '../platform/contract/service/presentation.js';
import { cursorRefusal, GateRefusal } from '../platform/contract/wire/refusal.js';
import { CurrentProject } from '../projects/contract/service/caller.js';
import { type Aim, Automation, type PlannedAction } from './contract/service/automation.js';
import type { Navigation } from './contract/wire/host.js';
import { type Opener, Pages } from './contract/service/pages.js';
import { Profiles } from './contract/service/profiles.js';
import { COOKIE_OPERATIONS as COOKIE, type CookieOperationId } from './contract/wire/cookieOperations.js';
import { type ActionName, type ActionStep, PAGE_OPERATIONS as PAGE, type PageOperationId } from './contract/wire/pageOperations.js';
import { cookieSources, importCookies, type Origin } from './cookies.js';
import { PROFILE_OPERATIONS as PROFILE, type ProfileOperationId } from './contract/wire/profileOperations.js';
import {
  CONSOLE_ROWS,
  CONSOLE_STACK_ROWS,
  DOWNLOAD_ROWS,
  NETWORK_ROWS,
  PAGE_ROWS,
  PICTURE_BYTES,
  SNAPSHOT_LINES,
} from './contract/wire/rows.js';

const PAGE_CEILING = ceilingOf(PAGE_ROWS);
const DOWNLOAD_CEILING = ceilingOf(DOWNLOAD_ROWS);
const SNAPSHOT_CEILING = ceilingOf(SNAPSHOT_LINES);
const CONSOLE_CEILING = ceilingOf(CONSOLE_ROWS);
const CONSOLE_STACK_CEILING = ceilingOf(CONSOLE_STACK_ROWS);
const NETWORK_CEILING = ceilingOf(NETWORK_ROWS);

const threadOf = (caller: Caller): string | null => (caller.actor.kind === 'thread' ? caller.actor.threadId : null);

const openerOf = Effect.fnUntraced(function* (caller: Caller) {
  const { project } = yield* Effect.flatten(CurrentProject);
  return { projectId: project.id, thread: threadOf(caller), human: caller.actor.kind === 'operator' } satisfies Opener;
});

const pageOf = Effect.fnUntraced(function* (caller: Caller, page: Parameters<Pages['Service']['resolve']>[1]) {
  const opener = yield* openerOf(caller);
  const resolved = yield* (yield* Pages).resolve(opener, page);
  return { page: resolved.id, thread: opener.thread };
});

const shape = (reason: string) => new GateRefusal('action-shape', reason, ['send the fields this action takes']);

const aimOf = (ref: string | undefined, x: number | undefined, y: number | undefined): Aim | null =>
  ref !== undefined ? { ref } : x !== undefined && y !== undefined ? { x, y } : null;

const NEEDS_AIM: ReadonlySet<ActionName> = new Set([
  'click',
  'double-click',
  'hover',
  'focus',
  'check',
  'uncheck',
  'select',
  'drag',
  'upload',
]);

const actionOf = (input: ActionStep, caller: Caller): PlannedAction => {
  const aim = aimOf(input.ref, input.x, input.y);
  if (aim === null && NEEDS_AIM.has(input.action)) return shape(`${input.action} needs \`ref\` or both \`x\` and \`y\``);
  const aimed = aim as Aim;
  switch (input.action) {
    case 'click':
    case 'double-click':
    case 'hover':
    case 'focus':
    case 'check':
    case 'uncheck':
      return { kind: input.action, aim: aimed };
    case 'fill':
    case 'type':
      return input.text === undefined ? shape(`${input.action} needs \`text\``) : { kind: input.action, aim, text: input.text };
    case 'press':
      return input.key === undefined ? shape('press needs `key`, like Enter or Control+A') : { kind: 'press', aim, key: input.key };
    case 'select':
      return input.values === undefined || input.values.length === 0
        ? shape('select needs `values`')
        : { kind: 'select', aim: aimed, values: input.values };
    case 'scroll':
      return { kind: 'scroll', aim, dx: input.dx ?? 0, dy: input.dy ?? (aim === null ? 600 : 0) };
    case 'drag': {
      const to = input.to === undefined ? null : aimOf(input.to.ref, input.to.x, input.to.y);
      return to === null ? shape('drag needs `to` with `ref` or `x` and `y`') : { kind: 'drag', aim: aimed, to };
    }
    case 'upload': {
      if (input.files === undefined || input.files.length === 0) return shape('upload needs `files`');
      if (caller.files === null) return shape('upload takes files of a checkout; this call stands in none');
      const reach = caller.files;
      return { kind: 'upload', aim: aimed, files: input.files.map((file) => reach.resolve(file)) };
    }
  }
};

const navigationOf = (input: (typeof PAGE.navigate_page)['input']['Type']): Navigation | GateRefusal<'action-shape'> => {
  if ((input.url === undefined) === (input.go === undefined)) return shape('name either `url` or `go`');
  if (input.url !== undefined) return { kind: 'url', url: input.url };
  return { kind: input.go! };
};

const listed = (projectId: number, closed: boolean): PageQuestion => ({
  operation: 'list_pages',
  selection: { projectId, closed },
  order: PAGE_ROWS.order,
});

export const PAGE_PAIRS: { readonly [K in PageOperationId]: OperationPair<(typeof PAGE)[K]> } = {
  open_page: pair(
    PAGE.open_page,
    body(PAGE.open_page, {
      voice: saidLines((answer) => [
        `Opened ${answer.page.id} ${answer.page.state}${answer.page.live.loading ? ' loading' : ''} ${answer.page.url}${answer.page.title === '' ? '' : ` ${JSON.stringify(answer.page.title)}`}`,
        ...(answer.page.live.dialog === null ? [] : [`Dialog: ${JSON.stringify(answer.page.live.dialog)}`]),
        `snapshot_page ${JSON.stringify({ project: answer.page.projectId, page: answer.page.id, limit: SNAPSHOT_CEILING })}`,
        `capture_page ${JSON.stringify({ project: answer.page.projectId, page: answer.page.id })}`,
      ]),
      execute: Effect.fnUntraced(function* (input, _prepared, caller) {
        const opener = yield* openerOf(caller);
        const pages = yield* Pages;
        const driven = opener.thread !== null && input.url !== undefined;
        const opened = yield* pages.open(opener, { url: driven ? 'about:blank' : (input.url ?? 'about:blank'), profile: input.profile });
        if (driven)
          yield* (yield* Automation)
            .navigate(opened.id, { kind: 'url', url: input.url! }, opener.thread)
            .pipe(
              Effect.tapError(() =>
                pages
                  .close(opened.id)
                  .pipe(
                    Effect.catchTag('GateRefusal', (refusal) =>
                      Effect.logWarning(`browser: the page ${opened.id} whose first navigation failed stays open: ${refusal.message}`),
                    ),
                  ),
              ),
            );
        return { status: 'opened' as const, page: driven ? yield* pages.resolve(opener, opened.id) : opened };
      }),
    }),
  ),
  close_page: pair(
    PAGE.close_page,
    body(PAGE.close_page, {
      execute: Effect.fnUntraced(function* (input, _prepared, caller) {
        const { page } = yield* pageOf(caller, input.page);
        yield* (yield* Pages).close(page);
        return { status: 'closed' as const, page };
      }),
    }),
  ),
  list_pages: pair(
    PAGE.list_pages,
    body(PAGE.list_pages, {
      execute: Effect.fnUntraced(function* (input, _prepared, caller) {
        const opener = yield* openerOf(caller);
        const closed = input.closed === true;
        const question = listed(opener.projectId, closed);
        const read = input.cursor === undefined ? null : readCursor(input.cursor, question);
        if (read !== null && 'refused' in read) return yield* cursorRefusal(read.refused);
        const [at, id] = read === null ? [] : read.at;
        if (read !== null && (typeof at !== 'number' || typeof id !== 'string')) return yield* cursorRefusal('bad-cursor');
        const limit = pageRows(input.limit, PAGE_ROWS, PAGE_CEILING);
        const page = yield* (yield* Pages).list(opener.projectId, {
          closed,
          limit,
          after: read === null ? null : { at: at as number, id: id as string },
        });
        const last = page.pages.at(-1);
        const more = page.pages.length === limit && last !== undefined;
        const stamp = (held: NonNullable<typeof last>) => Date.parse(closed ? (held.closedAt ?? held.activeAt) : held.activeAt);
        return {
          status: 'listed' as const,
          pages: page.pages,
          shown: page.pages.length,
          total: page.total,
          next: more ? mintCursor(question, [stamp(last), last.id]) : null,
        };
      }),
    }),
  ),
  navigate_page: pair(
    PAGE.navigate_page,
    body(PAGE.navigate_page, {
      execute: Effect.fnUntraced(function* (input, _prepared, caller) {
        const to = navigationOf(input);
        if (to instanceof GateRefusal) return yield* to;
        const { page, thread } = yield* pageOf(caller, input.page);
        return { status: 'navigated' as const, page: yield* (yield* Automation).navigate(page, to, thread) };
      }),
    }),
  ),
  snapshot_page: pair(
    PAGE.snapshot_page,
    body(PAGE.snapshot_page, {
      execute: Effect.fnUntraced(function* (input, _prepared, caller) {
        const { page, thread } = yield* pageOf(caller, input.page);
        const limit = pageRows(input.limit, SNAPSHOT_LINES, SNAPSHOT_CEILING);
        return { status: 'snapshot' as const, ...(yield* (yield* Automation).snapshot(page, { within: input.within, limit }, thread)) };
      }),
    }),
  ),
  act_on_page: pair(
    PAGE.act_on_page,
    body(PAGE.act_on_page, {
      execute: Effect.fnUntraced(function* (input, _prepared, caller) {
        const { page, thread } = yield* pageOf(caller, input.page);
        const run = yield* (yield* Automation).act(
          page,
          input.steps.map((step) => actionOf(step, caller)),
          thread,
        );
        return { status: 'acted' as const, ...run };
      }),
    }),
  ),
  emulate_page: pair(
    PAGE.emulate_page,
    body(PAGE.emulate_page, {
      execute: Effect.fnUntraced(function* (input, _prepared, caller) {
        const { page, thread } = yield* pageOf(caller, input.page);
        const emulated = yield* (yield* Automation).emulate(
          page,
          { viewport: input.viewport, device: input.device, scheme: input.scheme, clear: input.clear === true },
          thread,
        );
        return { status: 'emulated' as const, ...emulated };
      }),
    }),
  ),
  capture_page: pair(
    PAGE.capture_page,
    body(PAGE.capture_page, {
      execute: Effect.fnUntraced(function* (input, _prepared, caller) {
        const { page, thread } = yield* pageOf(caller, input.page);
        const captured = yield* (yield* Automation).capture(page, input.what ?? 'viewport', input.ref, thread);
        return {
          status: 'captured' as const,
          page: captured.page,
          path: captured.path,
          mediaType: captured.mediaType,
          bytes: captured.bytes.byteLength,
          width: captured.width,
          height: captured.height,
        };
      }),
      media: (answer) =>
        answer.mediaType !== 'image/png' || answer.bytes > PICTURE_BYTES
          ? Effect.succeed([])
          : Effect.flatMap(Automation, (automation) =>
              Effect.map(automation.picture(answer.path), (bytes) => [{ bytes, mediaType: answer.mediaType, label: answer.path }]),
            ),
    }),
  ),
  evaluate_in_page: pair(
    PAGE.evaluate_in_page,
    body(PAGE.evaluate_in_page, {
      execute: Effect.fnUntraced(function* (input, _prepared, caller) {
        const { page, thread } = yield* pageOf(caller, input.page);
        const evaluated = yield* (yield* Automation).evaluate(page, input.expression, thread);
        return 'exception' in evaluated ? { status: 'thrown' as const, ...evaluated } : { status: 'evaluated' as const, ...evaluated };
      }),
    }),
  ),
  wait_for_page: pair(
    PAGE.wait_for_page,
    body(PAGE.wait_for_page, {
      execute: Effect.fnUntraced(function* (input, _prepared, caller) {
        if (input.until !== 'load' && input.value === undefined) return yield* shape(`waiting for ${input.until} needs \`value\``);
        const { page, thread } = yield* pageOf(caller, input.page);
        const until = input.until === 'load' ? { kind: 'load' as const } : { kind: input.until, value: input.value! };
        return { status: 'met' as const, ...(yield* (yield* Automation).wait(page, until, input.timeoutMs, thread)) };
      }),
    }),
  ),
  read_page_console: pair(
    PAGE.read_page_console,
    body(PAGE.read_page_console, {
      execute: Effect.fnUntraced(function* (input, _prepared, caller) {
        const { page, thread } = yield* pageOf(caller, input.page);
        const read = yield* (yield* Automation).console(
          page,
          {
            level: input.level,
            match: input.match,
            after: input.after,
            limit: input.stack
              ? pageRows(input.limit, CONSOLE_STACK_ROWS, CONSOLE_STACK_CEILING)
              : pageRows(input.limit, CONSOLE_ROWS, CONSOLE_CEILING),
            seq: input.seq,
            stack: input.stack === true,
          },
          thread,
        );
        return {
          status: 'read' as const,
          page,
          entries: read.entries,
          shown: read.entries.length,
          total: read.total,
          dropped: read.dropped,
          capturing: read.capturing,
        };
      }),
    }),
  ),
  read_page_network: pair(
    PAGE.read_page_network,
    body(PAGE.read_page_network, {
      execute: Effect.fnUntraced(function* (input, _prepared, caller) {
        const { page, thread } = yield* pageOf(caller, input.page);
        const automation = yield* Automation;
        if (input.body !== undefined)
          return { status: 'body' as const, page, request: input.body, ...(yield* automation.body(page, input.body, thread)) };
        const read = yield* automation.network(page, {
          match: input.match,
          failed: input.failed === true,
          after: input.after,
          limit: pageRows(input.limit, NETWORK_ROWS, NETWORK_CEILING),
        });
        return {
          status: 'read' as const,
          page,
          requests: read.entries,
          shown: read.entries.length,
          total: read.total,
          dropped: read.dropped,
        };
      }),
    }),
  ),
  read_page_downloads: pair(
    PAGE.read_page_downloads,
    body(PAGE.read_page_downloads, {
      execute: Effect.fnUntraced(function* (input, _prepared, caller) {
        const { page } = yield* pageOf(caller, input.page);
        const kept = yield* (yield* Pages).downloads(page);
        const downloads = kept.slice(-pageRows(input.limit, DOWNLOAD_ROWS, DOWNLOAD_CEILING)).reverse();
        return { status: 'read' as const, page, downloads, shown: downloads.length, total: kept.length };
      }),
    }),
  ),
  answer_page_dialog: pair(
    PAGE.answer_page_dialog,
    body(PAGE.answer_page_dialog, {
      execute: Effect.fnUntraced(function* (input, _prepared, caller) {
        const { page, thread } = yield* pageOf(caller, input.page);
        return { status: 'answered' as const, page: yield* (yield* Automation).answer(page, input.accept, input.text, thread) };
      }),
    }),
  ),
};

type ImportInput = (typeof COOKIE.import_cookies)['input']['Type'];

const originOf = (input: ImportInput): Origin | GateRefusal<'action-shape'> => {
  const named = [input.browser, input.from, input.file].filter((held) => held !== undefined).length;
  if (named !== 1) return shape('name exactly one of `browser`, `from` or `file`');
  if (input.browser !== undefined) return { kind: 'browser', browser: input.browser, profile: input.browserProfile };
  if (input.browserProfile !== undefined) return shape('`browserProfile` goes with `browser`');
  return input.from !== undefined ? { kind: 'tagma', profile: input.from } : { kind: 'file', file: input.file! };
};

export const COOKIE_PAIRS: { readonly [K in CookieOperationId]: OperationPair<(typeof COOKIE)[K]> } = {
  list_cookie_sources: pair(
    COOKIE.list_cookie_sources,
    body(COOKIE.list_cookie_sources, {
      execute: Effect.fnUntraced(function* () {
        return { status: 'listed' as const, ...(yield* cookieSources()) };
      }),
    }),
  ),
  import_cookies: pair(
    COOKIE.import_cookies,
    body(COOKIE.import_cookies, {
      execute: Effect.fnUntraced(function* (input, _prepared, caller) {
        const origin = originOf(input);
        if (origin instanceof GateRefusal) return yield* origin;
        return { status: 'imported' as const, profile: input.profile, ...(yield* importCookies(input.profile, origin, caller)) };
      }),
    }),
  ),
};

export const PROFILE_PAIRS: { readonly [K in ProfileOperationId]: OperationPair<(typeof PROFILE)[K]> } = {
  list_profiles: pair(
    PROFILE.list_profiles,
    body(PROFILE.list_profiles, {
      execute: Effect.fnUntraced(function* () {
        return { status: 'listed' as const, profiles: yield* (yield* Profiles).list };
      }),
    }),
  ),
  create_profile: pair(
    PROFILE.create_profile,
    body(PROFILE.create_profile, {
      execute: Effect.fnUntraced(function* (input) {
        const profile = yield* (yield* Profiles).create({
          name: input.name,
          adapter: input.adapter,
          document: input.document,
          console: input.console,
        });
        return { status: 'created' as const, profile };
      }),
    }),
  ),
  update_profile: pair(
    PROFILE.update_profile,
    body(PROFILE.update_profile, {
      execute: Effect.fnUntraced(function* (input) {
        return {
          status: 'updated' as const,
          profile: yield* (yield* Profiles).update(input.profile, { name: input.name, console: input.console }),
        };
      }),
    }),
  ),
  delete_profile: pair(
    PROFILE.delete_profile,
    body(PROFILE.delete_profile, {
      execute: Effect.fnUntraced(function* (input) {
        return { status: 'deleted' as const, profile: input.profile, pending: yield* (yield* Profiles).remove(input.profile) };
      }),
    }),
  ),
  clear_profile: pair(
    PROFILE.clear_profile,
    body(PROFILE.clear_profile, {
      execute: Effect.fnUntraced(function* (input) {
        return { status: 'cleared' as const, profile: input.profile, pending: yield* (yield* Profiles).clear(input.profile) };
      }),
    }),
  ),
};
