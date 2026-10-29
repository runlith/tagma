import { e2e } from './browser.ts';
import { Effect } from 'effect';
import { proveTouch } from './testing/touch.ts';

e2e.effect(
  'a trusted finger stays down while DOM facts complete and releases on scope failure',
  (fixture) =>
    Effect.gen(function* () {
      yield* Effect.promise(() =>
        fixture.page.setContent(
          '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden}#list{height:100%;overflow:auto}#content{height:6000px}</style><div id="list"><div id="content"></div></div>',
        ),
      );
      yield* proveTouch(fixture);
    }),
  { lanes: ['chromium'], context: { hasTouch: true, isMobile: true, viewport: { width: 402, height: 874 } } },
);
