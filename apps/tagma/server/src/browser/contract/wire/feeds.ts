import { Schema } from 'effect';
import { feed } from '../../../platform/contract/wire/operation.js';
import { PageId } from './ids.js';
import { PagesEvent } from './page.js';
import { Picked } from './pick.js';
import { FilesAnswer, FilesCall, InputAnswer, InputCall, ScreencastEvent, ScreencastInput } from './screencast.js';
import { DRIVE_REFUSALS } from './shape.js';

const projectId = Schema.Int.check(Schema.isGreaterThan(0));

export const PAGES_FEED = feed('browser.pages', {
  input: Schema.Struct({ projectId }),
  event: PagesEvent,
  refusals: [],
  callers: 'any',
  external: true,
  admission: 'project',
});

export const PICK_FEED = feed('browser.pick', {
  input: Schema.Struct({ projectId, page: PageId }),
  event: Picked,
  refusals: [...DRIVE_REFUSALS, 'stale-ref'],
  callers: 'any',
  external: true,
  admission: 'project',
});

export const SCREENCAST_FEED = feed('browser.screencast', {
  input: ScreencastInput,
  event: ScreencastEvent,
  refusals: DRIVE_REFUSALS,
  callers: 'any',
  external: true,
  admission: 'project',
  window: 6,
});

export const INPUT_FEED = feed('browser.input', {
  input: InputCall,
  event: InputAnswer,
  refusals: [...DRIVE_REFUSALS, 'viewer-unknown'],
  callers: 'any',
  external: true,
  stream: false,
  admission: 'project',
});

export const FILES_FEED = feed('browser.files', {
  input: FilesCall,
  event: FilesAnswer,
  refusals: [...DRIVE_REFUSALS, 'no-chooser'],
  callers: 'any',
  external: true,
  stream: false,
  admission: 'project',
});

export const BROWSER_FEEDS = [PAGES_FEED, PICK_FEED, SCREENCAST_FEED, INPUT_FEED, FILES_FEED] as const;
