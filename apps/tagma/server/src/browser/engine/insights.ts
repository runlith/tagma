import type * as Trace from '@paulirish/trace_engine';
import type { InsightName } from '../contract/wire/trace.js';

type Models = Trace.Insights.Types.InsightModels;
type Model<K extends InsightName> = NonNullable<Models[K]>;
type Request = Trace.Types.Events.SyntheticNetworkRequest;
type Frame = { readonly functionName: string; readonly url: string; readonly lineNumber: number };

export type Told = { readonly line: string; readonly lines: readonly string[] };

export type Origin = { readonly micro: number };

const LISTED = 15;
const NAMED = 5;
const LINE_CHARS = 400;

const round = (value: number): number => Math.round(value * 10) / 10;

export const msOf = (micro: number): number => round(micro / 1_000);

const ms = (milli: number): string => `${Math.round(milli)} ms`;

const span = (micro: number): string => ms(micro / 1_000);

const at = (origin: Origin, micro: number): string => `at ${ms((micro - origin.micro) / 1_000)}`;

const size = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${round(bytes / 1024 / 1024)} MiB` : bytes >= 1024 ? `${Math.round(bytes / 1024)} KiB` : `${bytes} B`;

const urlOf = (request: Request): string => request.args.data.url;

const count = (amount: number, noun: string): string => `${amount} ${noun}${amount === 1 ? '' : 's'}`;

const called = (frame: Frame | null): string =>
  frame === null
    ? 'unattributed code'
    : `${frame.functionName === '' ? '(anonymous)' : frame.functionName} ${frame.url === '' ? '' : `${frame.url}:${frame.lineNumber + 1}`}`.trim();

const capped = (lines: readonly string[]): readonly string[] =>
  lines.length > LISTED ? [...lines.slice(0, LISTED), `… ${lines.length - LISTED} more`] : lines;

const checks = (list: Readonly<Record<string, { readonly value: boolean }>> | undefined, words: Readonly<Record<string, string>>) =>
  Object.entries(list ?? {}).map(([key, check]) => `${check.value ? 'passes' : 'fails'}: ${words[key] ?? key}`);

const lcpBreakdown = (model: Model<'LCPBreakdown'>): Told => {
  if (model.lcpMs === undefined) return { line: 'no LCP was detected', lines: [] };
  const node = model.lcpEvent?.args.data;
  const element = node?.nodeName ?? node?.type ?? 'an element';
  const url = model.lcpRequest === undefined ? '' : ` loading ${urlOf(model.lcpRequest)}`;
  const parts = model.subparts;
  return {
    line: `LCP ${ms(model.lcpMs)} on ${element}${url}`,
    lines:
      parts === undefined
        ? []
        : [
            `time to first byte ${span(parts.ttfb.range)}`,
            ...(parts.loadDelay === undefined ? [] : [`resource load delay ${span(parts.loadDelay.range)}`]),
            ...(parts.loadDuration === undefined ? [] : [`resource load duration ${span(parts.loadDuration.range)}`]),
            `element render delay ${span(parts.renderDelay.range)}`,
          ],
  };
};

const inpBreakdown = (model: Model<'INPBreakdown'>, origin: Origin): Told => {
  const inp = model.highPercentileInteractionEvent;
  const longest = model.longestInteractionEvent;
  if (inp === undefined || longest === undefined) return { line: 'no interaction was recorded', lines: [] };
  return {
    line: `INP ${span(inp.dur)} on a ${inp.type} ${at(origin, inp.ts)}`,
    lines: [
      `input delay ${span(inp.inputDelay)}`,
      `processing duration ${span(inp.mainThreadHandling)}`,
      `presentation delay ${span(inp.presentationDelay)}`,
      ...(longest === inp ? [] : [`the longest interaction, a ${longest.type} ${at(origin, longest.ts)}, took ${span(longest.dur)}`]),
    ],
  };
};

const CULPRITS = ['web font', 'injected iframe', 'animation', 'unsized image'] as const;

const clsCulprits = (model: Model<'CLSCulprits'>, origin: Origin): Told => {
  const worst = model.worstCluster;
  if (worst === undefined) return { line: 'no layout shift was recorded', lines: [] };
  const culprits = model.topCulpritsByCluster.get(worst) ?? [];
  return {
    line: `CLS ${worst.clusterCumulativeScore.toFixed(3)}: the worst cluster, ${count(worst.events.length, 'shift')} ${at(origin, worst.ts)}`,
    lines: capped([
      ...culprits.map((culprit) =>
        'url' in culprit && typeof culprit.url === 'string' ? `${CULPRITS[culprit.type]} ${culprit.url}` : CULPRITS[culprit.type],
      ),
      ...(model.animationFailures.length === 0 ? [] : [`animations not composited: ${model.animationFailures.length}`]),
    ]),
  };
};

const documentLatency = (model: Model<'DocumentLatency'>): Told => {
  const data = model.data;
  if (data === undefined) return { line: 'no document request was recorded', lines: [] };
  const document = data.documentRequest === undefined ? 'the document' : urlOf(data.documentRequest);
  return {
    line: `${document}: server responded in ${ms(data.serverResponseTime)}, redirects took ${ms(data.redirectDuration)}`,
    lines: [
      ...checks(data.checklist, {
        noRedirects: 'no redirects',
        serverResponseIsFast: 'server responds quickly',
        usesCompression: 'text compression',
      }),
      ...(data.uncompressedResponseBytes > 0 ? [`${size(data.uncompressedResponseBytes)} sent uncompressed`] : []),
    ],
  };
};

const renderBlocking = (model: Model<'RenderBlocking'>): Told => ({
  line:
    model.renderBlockingRequests.length === 0
      ? 'no request blocked the first render'
      : `render-blocking requests (${model.renderBlockingRequests.length}): ${model.renderBlockingRequests.slice(0, NAMED).map(urlOf).join(', ')}${model.renderBlockingRequests.length > NAMED ? ', …' : ''}`,
  lines: capped(
    model.renderBlockingRequests.map((request) => {
      const wasted = model.requestIdToWastedMs?.get(request.args.data.requestId);
      return `${urlOf(request)} took ${span(request.dur)}${wasted === undefined ? '' : `, delaying the render by ${ms(wasted)}`}`;
    }),
  ),
});

const lcpDiscovery = (model: Model<'LCPDiscovery'>): Told => {
  const request = model.lcpRequest;
  if (request === undefined) return { line: model.lcpEvent === undefined ? 'no LCP was detected' : 'the LCP is not an image', lines: [] };
  const late =
    model.earliestDiscoveryTimeTs === undefined ? '' : `, requested ${span(request.ts - model.earliestDiscoveryTimeTs)} after it could be`;
  return {
    line: `the LCP image ${urlOf(request)}${late}`,
    lines: checks(model.checklist, {
      priorityHinted: 'fetchpriority=high',
      requestDiscoverable: 'discoverable in the initial document',
      eagerlyLoaded: 'not lazy-loaded',
    }),
  };
};

type Critical = Trace.Insights.Models.NetworkDependencyTree.CriticalRequestNode;

const networkDependencyTree = (model: Model<'NetworkDependencyTree'>): Told => {
  const lines: string[] = [];
  const walk = (nodes: readonly Critical[], depth: number) => {
    for (const node of nodes) {
      lines.push(
        `${'  '.repeat(depth)}${urlOf(node.request)} at ${span(node.timeFromInitialRequest)}${node.isLongest ? ' (longest chain)' : ''}`,
      );
      walk(node.children, depth + 1);
    }
  };
  walk(model.rootNodes, 0);
  return {
    line: `the longest chain of critical requests ends at ${span(model.maxTime)}`,
    lines: capped([
      ...lines,
      ...model.preconnectCandidates.map((candidate) => `preconnect candidate ${candidate.origin}`),
      ...model.preconnectedOrigins.map((origin) => `preconnected ${origin.url}`),
    ]),
  };
};

const imageDelivery = (model: Model<'ImageDelivery'>): Told => ({
  line:
    model.optimizableImages.length === 0
      ? 'every image is delivered efficiently'
      : `optimizable images (${model.optimizableImages.length}) could be ${size(model.wastedBytes)} smaller`,
  lines: capped(
    model.optimizableImages.map(
      (image) =>
        `${urlOf(image.request)} could save ${size(image.byteSavings)}: ${image.optimizations
          .map((optimization) =>
            'displayDimensions' in optimization
              ? `served ${optimization.fileDimensions.width}×${optimization.fileDimensions.height}, shown ${optimization.displayDimensions.width}×${optimization.displayDimensions.height}`
              : optimization.type.toLowerCase().replaceAll('_', ' '),
          )
          .join(', ')}`,
    ),
  ),
});

const fontDisplay = (model: Model<'FontDisplay'>): Told => ({
  line: model.fonts.length === 0 ? 'no web font hid text' : `web fonts hiding text while loading: ${model.fonts.length}`,
  lines: capped(
    model.fonts.map((font) => `${font.name ?? urlOf(font.request)} font-display: ${font.display}, text hidden ${ms(font.wastedTime)}`),
  ),
});

const viewport = (model: Model<'Viewport'>): Told => ({
  line:
    model.mobileOptimized === null
      ? 'no viewport meta tag was read'
      : model.mobileOptimized
        ? 'the viewport is optimized for mobile'
        : 'the viewport is not optimized for mobile: taps wait for a double-tap check',
  lines: model.viewportEvent === undefined ? [] : [`<meta name="viewport" content="${model.viewportEvent.args.data.content}">`],
});

const domSize = (model: Model<'DOMSize'>): Told => ({
  line: model.largeUpdates.length === 0 ? 'no large layout or style update' : `large layout or style updates: ${model.largeUpdates.length}`,
  lines: capped(model.largeUpdates.map((update) => `${update.size} elements updated in ${ms(update.duration)}`)),
});

const thirdParties = (model: Model<'ThirdParties'>): Told => {
  const others = model.entitySummaries.filter((summary) => summary.entity !== model.firstPartyEntity);
  return {
    line: others.length === 0 ? 'no third-party code ran' : `third parties that transferred or ran code: ${others.length}`,
    lines: capped(
      [...others]
        .sort((left, right) => right.mainThreadTime - left.mainThreadTime)
        .map((summary) => `${summary.entity.name}: ${size(summary.transferSize)}, ${ms(summary.mainThreadTime)} on the main thread`),
    ),
  };
};

const duplicatedJavaScript = (model: Model<'DuplicatedJavaScript'>): Told => {
  const modules = [...model.duplicationGroupedByNodeModules].sort(
    ([, left], [, right]) => right.estimatedDuplicateBytes - left.estimatedDuplicateBytes,
  );
  return {
    line: modules.length === 0 ? 'no module is shipped twice' : `modules shipped more than once: ${modules.length}`,
    lines: capped(
      modules.map(
        ([name, held]) =>
          `${name}: ${size(held.estimatedDuplicateBytes)} duplicated in ${held.duplicates.map((copy) => copy.script.url ?? 'an inline script').join(', ')}`,
      ),
    ),
  };
};

const slowCssSelector = (model: Model<'SlowCSSSelector'>): Told => ({
  line: `selector matching took ${ms(model.totalElapsedMs)} over ${model.totalMatchAttempts} attempts`,
  lines: [
    ...(model.topSelectorElapsedMs === null
      ? []
      : [`slowest: ${model.topSelectorElapsedMs.selector} ${ms(model.topSelectorElapsedMs['elapsed (us)'] / 1_000)}`]),
    ...(model.topSelectorMatchAttempts === null
      ? []
      : [`most attempted: ${model.topSelectorMatchAttempts.selector} ${model.topSelectorMatchAttempts.match_attempts} attempts`]),
  ],
});

const forcedReflow = (model: Model<'ForcedReflow'>): Told => {
  const top = model.topLevelFunctionCallData;
  return {
    line:
      top === undefined
        ? 'no script forced a synchronous layout'
        : `${called(top.topLevelFunctionCall)} forced layout for ${span(top.totalReflowTime)}`,
    lines: capped(model.aggregatedBottomUpData.map((stack) => `${called(stack.bottomUpData)}: ${span(stack.totalTime)}`)),
  };
};

const cache = (model: Model<'Cache'>): Told => ({
  line:
    model.requests.length === 0
      ? 'no static resource was flagged for a short cache lifetime'
      : `static resources cached briefly: ${model.requests.length}`,
  lines: capped(
    model.requests.map(
      (held) => `${urlOf(held.request)} cached ${held.ttl === 0 ? 'not at all' : `for ${held.ttl} s`}, ${size(held.wastedBytes)} refetched`,
    ),
  ),
});

const characterSet = (model: Model<'CharacterSet'>): Told => {
  const data = model.data;
  return {
    line:
      data === undefined
        ? 'no document request was recorded'
        : data.hasHttpCharset
          ? 'the charset is declared in HTTP'
          : 'the charset is not declared in HTTP',
    lines: checks(data?.checklist, { httpCharset: 'charset in the Content-Type header', metaCharset: 'early <meta charset>' }),
  };
};

const modernHttp = (model: Model<'ModernHTTP'>): Told => ({
  line:
    model.http1Requests.length === 0
      ? 'no eligible origin served its assets over HTTP/1.1'
      : `HTTP/1.1 requests: ${model.http1Requests.length}`,
  lines: capped(model.http1Requests.map(urlOf)),
});

const legacyJavaScript = (model: Model<'LegacyJavaScript'>): Told => {
  const scripts = [...model.legacyJavaScriptResults];
  return {
    line:
      scripts.length === 0
        ? 'no legacy polyfill or transform was shipped'
        : `scripts shipping legacy polyfills or transforms: ${scripts.length}`,
    lines: capped(
      scripts.map(
        ([script, held]) =>
          `${script.url ?? 'an inline script'}: ${size(held.estimatedByteSavings)}, ${held.matches.map((match) => match.name).join(', ')}`,
      ),
    ),
  };
};

const TELLING: { readonly [K in InsightName]: (model: Model<K>, origin: Origin) => Told } = {
  LCPBreakdown: lcpBreakdown,
  INPBreakdown: inpBreakdown,
  CLSCulprits: clsCulprits,
  DocumentLatency: documentLatency,
  RenderBlocking: renderBlocking,
  LCPDiscovery: lcpDiscovery,
  NetworkDependencyTree: networkDependencyTree,
  ImageDelivery: imageDelivery,
  FontDisplay: fontDisplay,
  Viewport: viewport,
  DOMSize: domSize,
  ThirdParties: thirdParties,
  DuplicatedJavaScript: duplicatedJavaScript,
  SlowCSSSelector: slowCssSelector,
  ForcedReflow: forcedReflow,
  Cache: cache,
  CharacterSet: characterSet,
  ModernHTTP: modernHttp,
  LegacyJavaScript: legacyJavaScript,
};

const SAVED = ['LCP', 'FCP', 'INP', 'TBT', 'CLS'] as const;

const savingsOf = (model: Trace.Insights.Types.InsightModel): string | null => {
  const saved = SAVED.flatMap((metric) => {
    const value = model.metricSavings?.[metric];
    if (value === undefined || !Number.isFinite(value) || value <= 0) return [];
    return [metric === 'CLS' ? `CLS ${value.toFixed(3)}` : `${metric} ${ms(value)}`];
  });
  if (model.wastedBytes !== undefined && model.wastedBytes > 0) saved.push(size(model.wastedBytes));
  return saved.length === 0 ? null : `estimated saving ${saved.join(', ')}`;
};

export const bounded = (text: string): string => (text.length > LINE_CHARS ? `${text.slice(0, LINE_CHARS)}…` : text);

export const tell = <K extends InsightName>(name: K, model: Model<K>, origin: Origin): Told => {
  const told = TELLING[name](model, origin);
  const saving = savingsOf(model);
  return { line: bounded(saving === null ? told.line : `${told.line}; ${saving}`), lines: told.lines.map(bounded) };
};
