export const scenarioNames = [
  'open-tail',
  'fling-wheel',
  'fling-touch',
  'drag-page-landing',
  'page-mid-fling',
  'streaming-paused',
  'rail-during-fling',
  'latest',
  'disclosure-above',
  'disclosure-at',
  'disclosure-below',
  'width',
  'keyboard',
  'thumb-history',
] as const;
export type ScenarioName = (typeof scenarioNames)[number];
export type DisclosurePosition = 'above' | 'at' | 'below';
export const chromiumOnly: readonly ScenarioName[] = ['fling-touch', 'drag-page-landing', 'thumb-history'];
