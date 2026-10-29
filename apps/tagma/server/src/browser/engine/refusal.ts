import type { CommandFailure } from '@runlith/cdp/session';
import { Effect } from 'effect';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { DriveRefusal } from '../contract/service/automation.js';
import type { DomainBlock } from '../contract/wire/domains.js';
import { hostRefusal, outcomeUnknown } from '../contract/service/pages.js';
import type { HostFailure, NavigationBlocked } from '../contract/service/hosts.js';
import type { PageId } from '../contract/wire/ids.js';
import type { Page } from '../contract/wire/page.js';

export const navigationBlocked = (block: DomainBlock) =>
  new GateRefusal('domain-blocked', `${block.domain} was not loaded: ${block.setting} blocked agent navigation to this domain`, [
    `choose a domain permitted by ${block.setting}; the operator can change that setting`,
  ]);

export const navigationRefusal = (failure: HostFailure | NavigationBlocked) =>
  failure._tag === 'NavigationBlocked' ? navigationBlocked(failure) : hostRefusal(failure);

export const unknownPage = (page: PageId) =>
  new GateRefusal('page-unknown', `page ${page} is no longer open`, ['list_pages — the open pages of this project']);

export const unresponsive = (page: PageId) =>
  new GateRefusal('page-unresponsive', `page ${page} does not answer: its renderer is busy or hung`, [
    'navigate_page with go: reload',
    'close_page',
  ]);

export const frameUnresponsive = (page: PageId, frame: string, related: readonly Page[]) =>
  new GateRefusal(
    'page-unresponsive',
    `frame ${frame} of page ${page} does not answer; an in-place reload cannot guarantee a fresh renderer without affecting other pages`,
    [
      'list_profiles then open_page with another connected profile; reopening in this profile may reuse the hung renderer while its browser process lives',
      'to reuse this profile, wait for its browser process to end after its pages close; close_page only for pages opened by your thread, and ask the operator about every other page listed below',
      ...related
        .filter((held) => held.state === 'live')
        .map(
          (held) =>
            `page ${held.id}, project ${held.projectId}, profile ${held.profile}, ${held.openedBy === null ? 'opened outside a thread (operator or external caller)' : `opened by thread ${held.openedBy}`}: ${held.url}`,
        ),
    ],
  );

export const crashed = (page: PageId) =>
  new GateRefusal('page-crashed', `the renderer of page ${page} crashed`, ['navigate_page with go: reload', 'close_page']);

export const devtoolsOpen = (page: PageId) =>
  new GateRefusal<DriveRefusal>('devtools-open', `page ${page} is in the operator's DevTools`, [
    "the page is in the operator's DevTools; it continues once DevTools close",
  ]);

export const ended = (page: PageId, failure: CommandFailure): Effect.Effect<never, GateRefusal<DriveRefusal>> => {
  switch (failure._tag) {
    case 'SessionEnded':
      if (failure.child !== undefined)
        return Effect.fail(
          new GateRefusal('action-failed', `a frame of page ${page} left while the engine waited on it`, [
            'read the page again with snapshot_page and act on what it shows',
          ]),
        );
      if (failure.pending) return Effect.fail(outcomeUnknown(failure.message));
      if (failure.end === 'detached')
        return Effect.fail(
          new GateRefusal('host-refused', `the browser session of page ${page} detached: ${failure.message}`, [
            'snapshot_page — reconnect and read the page before continuing',
          ]),
        );
      if (failure.end === 'taken') return Effect.fail(devtoolsOpen(page));
      return Effect.fail(
        new GateRefusal('host-away', `the browser host of page ${page} stopped answering: ${failure.message}`, ['make the call again']),
      );
    case 'CommandRefused':
      return Effect.fail(
        new GateRefusal('action-failed', `the browser refused ${failure.method}: ${failure.message}`, [
          'read the page again with snapshot_page and act on what it shows',
        ]),
      );
    case 'PayloadUnreadable':
    case 'WorkerUnavailable':
      return Effect.fail(
        new GateRefusal('action-failed', `the answer of the browser could not be read: ${failure.message}`, ['make the call again']),
      );
  }
};
