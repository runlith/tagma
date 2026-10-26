import { expect, test } from 'bun:test';
import { TIMELINE_DECLARATION } from './contract/wire/fragment.js';
import { declaredTimeline } from './declaration.js';

const TIMELINE = { v: 1, duration: 6, fps: 30, width: 1920, height: 1080 } as const;
const BODY = '{"v":1,"duration":6,"fps":30,"width":1920,"height":1080}';

test('only the script element the page itself finds by id declares the timeline', () => {
  expect(declaredTimeline(`<!-- ${TIMELINE_DECLARATION} -->${TIMELINE_DECLARATION}`)).toEqual({ timeline: TIMELINE, problem: null });
  expect(declaredTimeline(`<script data-id="tagma-timeline" type="application/json">${BODY}</script>`)).toEqual({
    timeline: null,
    problem: null,
  });
  expect(declaredTimeline(`<script type="application/json" id="TAGMA-TIMELINE">${BODY}</script>`)).toEqual({
    timeline: null,
    problem: null,
  });
  expect(declaredTimeline(`<SCRIPT TYPE='application/json' ID=tagma-timeline>${BODY}</SCRIPT>`)).toEqual({
    timeline: TIMELINE,
    problem: null,
  });
});
