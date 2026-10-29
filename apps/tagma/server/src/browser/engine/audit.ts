import AXE from 'axe-core/axe.min.js' with { type: 'text' };
import type { CommandFailure } from '@runlith/cdp/session';
import type { Protocol } from 'devtools-protocol';
import { Data, Effect } from 'effect';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { AuditQuery } from '../contract/service/automation.js';
import { Pages } from '../contract/service/pages.js';
import { HTML_CHARS, type Violation, WHY_CHARS } from '../contract/wire/audit.js';
import type { PageId } from '../contract/wire/ids.js';
import type { Attached, Drive, Paged } from './drive.js';
import { holdStrain } from './emulate.js';
import { anchorOf, joined, locate, world } from './target.js';

class AuditThrew extends Data.TaggedError('AuditThrew')<{ readonly message: string }> {}

type Selector = string | readonly string[];

type FrameContext = { readonly frameSelector: Selector; readonly frameContext: unknown };

type Measured = {
  readonly rule: string;
  readonly impact: Violation['impact'];
  readonly help: string;
  readonly url: string;
  readonly wcag: readonly string[];
  readonly failing: number;
  readonly nodes: readonly { readonly target: readonly Selector[]; readonly why: string; readonly html: string }[];
};

type Finished = { readonly violations: readonly Measured[]; readonly incomplete: number; readonly passed: number };

const LOADED = `typeof axe === 'object' && typeof axe.runPartial === 'function'`;

const INSTALL = `${AXE}\n;axe.configure({ allowedOrigins: [] }); true`;

const FRAMES = `function (context) { return axe.utils.getFrameContexts(context ?? (this instanceof Node ? this : document)); }`;

const PARTIAL = `function (context, options, held) {
  return axe.runPartial(context ?? (this instanceof Node ? this : document), options).then((partial) => {
    if (!held) return new TextEncoder().encode(JSON.stringify(partial)).toBase64();
    globalThis.heldAudit = partial;
    return '';
  });
}`;

const FINISH = `function (partials, options, limit, whyChars, htmlChars) {
  const held = globalThis.heldAudit;
  globalThis.heldAudit = undefined;
  const cut = (text, chars) => (text.length > chars ? text.slice(0, chars - 1) + '…' : text);
  return axe.finishRun([held, ...partials.map((partial) => (partial === null ? null : JSON.parse(new TextDecoder().decode(Uint8Array.fromBase64(partial)))))], options).then((results) => {
    const rank = { critical: 0, serious: 1, moderate: 2, minor: 3 };
    const violations = [...results.violations].sort((a, b) => (rank[a.impact] ?? 4) - (rank[b.impact] ?? 4) || b.nodes.length - a.nodes.length);
    const shown = violations.map(() => 0);
    for (let left = limit, round = 0; left > 0; round += 1) {
      let gave = false;
      violations.forEach((violation, at) => {
        if (left > 0 && violation.nodes.length > round) { shown[at] += 1; left -= 1; gave = true; }
      });
      if (!gave) break;
    }
    const why = (node) => (node.none[0] ?? node.all[0] ?? node.any[0])?.message ?? node.failureSummary ?? '';
    return {
      violations: violations.map((violation, at) => ({
        rule: violation.id,
        impact: violation.impact ?? null,
        help: violation.help,
        url: violation.helpUrl,
        wcag: violation.tags.filter((tag) => tag.startsWith('wcag')),
        failing: violation.nodes.length,
        nodes: violation.nodes.slice(0, shown[at]).map((node) => ({ target: node.target, why: cut(why(node), whyChars), html: cut(node.html, htmlChars) })),
      })),
      incomplete: results.incomplete.reduce((sum, rule) => sum + rule.nodes.length, 0),
      passed: results.passes.length,
    };
  });
}`;

const SELECT = `function (selector) {
  let root = document;
  let found = null;
  for (const part of typeof selector === 'string' ? [selector] : selector) {
    if (root === null) return null;
    found = root.querySelector(part);
    root = found === null ? null : found.shadowRoot;
  }
  return found;
}`;

const failed = (reason: string) =>
  new GateRefusal('audit-failed', `the page was not audited: ${reason}`, [
    'audit_page with tags axe-core knows, such as wcag2a, wcag2aa, wcag21aa, wcag22aa or best-practice',
    'audit_page again once the page has loaded',
  ]);

const childGone = (failure: CommandFailure | GateRefusal<'stale-ref'> | AuditThrew): boolean =>
  failure._tag === 'AuditThrew' ||
  failure._tag === 'CommandRefused' ||
  failure._tag === 'GateRefusal' ||
  (failure._tag === 'SessionEnded' && failure.child !== undefined);

export const makeAudit = Effect.fnUntraced(function* (input: { readonly drive: Drive }) {
  const { drive } = input;
  const pages = yield* Pages;

  const audited = Effect.fnUntraced(function* (state: Paged, attached: Attached, query: AuditQuery) {
    yield* holdStrain(attached, { factor: 1, paused: true }).pipe(Effect.provideService(Pages, pages));
    const options = query.tags === undefined ? {} : { runOnly: { type: 'tag', values: query.tags } };

    const call = Effect.fnUntraced(function* (frame: string, declaration: string, args: readonly unknown[], object?: string) {
      const child = attached.frames.get(frame)?.child;
      const aim = object === undefined ? { executionContextId: yield* world(attached, frame) } : { objectId: object };
      const reply = yield* attached.session.send(
        'Runtime.callFunctionOn',
        { ...aim, functionDeclaration: declaration, arguments: args.map((value) => ({ value })), returnByValue: true, awaitPromise: true },
        child,
      );
      if (reply.exceptionDetails !== undefined)
        return yield* new AuditThrew({ message: reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text });
      return reply.result.value as unknown;
    });

    const install = Effect.fnUntraced(function* (frame: string) {
      const contextId = yield* world(attached, frame);
      const child = attached.frames.get(frame)?.child;
      const loaded = yield* attached.session.send('Runtime.evaluate', { expression: LOADED, contextId, returnByValue: true }, child);
      if (loaded.result.value === true) return;
      const installed = yield* attached.session.send('Runtime.evaluate', { expression: INSTALL, contextId, returnByValue: true }, child);
      if (installed.exceptionDetails !== undefined)
        return yield* new AuditThrew({ message: `axe-core did not load: ${installed.exceptionDetails.text}` });
    });

    const nodeIn = Effect.fnUntraced(function* (frame: string, selector: Selector) {
      const contextId = yield* world(attached, frame);
      const child = attached.frames.get(frame)?.child;
      const found = yield* attached.session.send(
        'Runtime.callFunctionOn',
        { executionContextId: contextId, functionDeclaration: SELECT, arguments: [{ value: selector }], objectGroup: attached.group },
        child,
      );
      const objectId = found.result.objectId;
      if (found.exceptionDetails !== undefined || objectId === undefined) return null;
      return (yield* attached.session.send('DOM.describeNode', { objectId }, child)).node;
    });

    const frameOf = Effect.fnUntraced(function* (owner: Protocol.DOM.Node | null) {
      const frame = owner?.frameId;
      if (frame === undefined) return undefined;
      const session = attached.sessions.get(frame);
      if (session !== undefined) yield* joined(attached, frame, session);
      else if (!attached.frames.has(frame)) {
        const { targetInfo } = yield* attached.session.send('Target.getTargetInfo', { targetId: frame });
        if (targetInfo.type !== 'iframe') return undefined;
        yield* joined(attached, frame);
      }
      return attached.frames.has(frame) ? frame : undefined;
    });

    const partials: (string | null)[] = [];
    const skipped: string[] = [];
    let frames = 0;
    const measured = new Map<string, string | undefined>();
    const same = (frame: string | undefined): frame is string =>
      frame !== undefined && measured.has(frame) && attached.frames.get(frame)?.loader === measured.get(frame);

    const run = Effect.fnUntraced(function* (
      frame: string,
      context: unknown,
      object: string | undefined,
      root: boolean,
    ): Effect.fn.Return<void, CommandFailure | GateRefusal<'stale-ref'> | AuditThrew> {
      yield* install(frame);
      measured.set(frame, attached.frames.get(frame)?.loader);
      const children = (yield* call(frame, FRAMES, [context], object)) as readonly FrameContext[];
      const partial = (yield* call(frame, PARTIAL, [context, options, root], object)) as string;
      if (!root) partials.push(partial);
      frames += 1;
      for (const { frameSelector, frameContext } of children) {
        const before = partials.length;
        let label = JSON.stringify(frameSelector);
        yield* Effect.gen(function* () {
          const child = yield* frameOf(yield* nodeIn(frame, frameSelector));
          if (child === undefined) return yield* new AuditThrew({ message: `the frame ${label} holds no document the engine reaches` });
          label = attached.frames.get(child)?.url ?? label;
          yield* run(child, frameContext, undefined, false);
        }).pipe(
          Effect.catchIf(childGone, () =>
            Effect.sync(() => {
              partials.length = before;
              partials.push(null);
              skipped.push(label);
            }),
          ),
        );
      }
    });

    const located = query.within === undefined ? null : yield* locate(state, attached, query.within);
    const root = located?.anchor.frame ?? attached.main;
    yield* run(root, null, located?.object, true).pipe(Effect.catchTag('AuditThrew', (threw) => Effect.fail(failed(threw.message))));
    const finished = (yield* call(root, FINISH, [partials, options, query.limit, WHY_CHARS, HTML_CHARS]).pipe(
      Effect.catchTag('AuditThrew', (threw) => Effect.fail(failed(threw.message))),
    )) as Finished;

    const owners = new Map<string, string | undefined>();
    const refOf = Effect.fnUntraced(function* (target: readonly Selector[]) {
      let frame: string | undefined = root;
      for (let at = 0; at < target.length - 1 && same(frame); at += 1) {
        const key = JSON.stringify(target.slice(0, at + 1));
        if (!owners.has(key)) owners.set(key, yield* frameOf(yield* nodeIn(frame, target[at]!)));
        frame = owners.get(key);
      }
      if (!same(frame)) return null;
      const node = yield* nodeIn(frame, target.at(-1)!);
      const anchor = node === null || !same(frame) ? undefined : anchorOf(attached, frame, node.backendNodeId);
      return anchor === undefined ? null : state.refs.issue(anchor);
    });
    const resolved = (target: readonly Selector[]) => refOf(target).pipe(Effect.catchIf(childGone, () => Effect.succeed(null)));

    const violations: Violation[] = [];
    for (const violation of finished.violations) {
      const nodes = [];
      for (const node of violation.nodes) nodes.push({ ref: yield* resolved(node.target), why: node.why, html: node.html });
      violations.push({ ...violation, nodes });
    }
    const shown = violations.reduce((sum, violation) => sum + violation.nodes.length, 0);
    const total = violations.reduce((sum, violation) => sum + violation.failing, 0);
    return { violations, shown, total, incomplete: finished.incomplete, passed: finished.passed, frames, skipped };
  }, Effect.scoped);

  return Effect.fn('Automation.audit')(function* (page: PageId, query: AuditQuery, thread: string | null) {
    const read = yield* drive.drive(page, thread, (state, attached) => audited(state, attached, query));
    return { page: pages.glance(page, false), ...read };
  });
});
