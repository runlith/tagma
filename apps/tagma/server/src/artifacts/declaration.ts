import { Result, Schema } from 'effect';
import { TIMELINE_ELEMENT, type Timeline, timelineSchema } from './contract/wire/timeline.js';

export type Declared = { readonly timeline: Timeline | null; readonly problem: string | null };

type Script = { readonly attributes: ReadonlyMap<string, string>; readonly body: string };

const decodeTimeline = Schema.decodeUnknownResult(timelineSchema);

const refused = (problem: string): Declared => ({ timeline: null, problem: `the ${TIMELINE_ELEMENT} declaration ${problem}` });

function* scripts(html: string): Generator<Script> {
  const MARKUP = /<!--|<script(?=[\s/>])/iy;
  const ATTRIBUTE = /[\s/]*([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*)))?/y;
  const SCRIPT_END = /<\/script/gi;
  let at = 0;
  while (at < html.length) {
    const open = html.indexOf('<', at);
    if (open < 0) return;
    MARKUP.lastIndex = open;
    const markup = MARKUP.exec(html)?.[0];
    if (markup === undefined) {
      at = open + 1;
      continue;
    }
    if (markup === '<!--') {
      const end = html.indexOf('-->', open + 4);
      if (end < 0) return;
      at = end + 3;
      continue;
    }
    const attributes = new Map<string, string>();
    let cursor = open + markup.length;
    for (;;) {
      ATTRIBUTE.lastIndex = cursor;
      const attribute = ATTRIBUTE.exec(html);
      if (attribute === null || attribute[0].length === 0) break;
      const name = attribute[1]!.toLowerCase();
      if (!attributes.has(name)) attributes.set(name, attribute[2] ?? attribute[3] ?? attribute[4] ?? '');
      cursor = ATTRIBUTE.lastIndex;
    }
    const close = html.indexOf('>', cursor);
    if (close < 0) return;
    SCRIPT_END.lastIndex = close + 1;
    const end = SCRIPT_END.exec(html);
    const bodyEnd = end === null ? html.length : end.index;
    yield { attributes, body: html.slice(close + 1, bodyEnd) };
    at = end === null ? html.length : SCRIPT_END.lastIndex;
  }
}

export function declaredTimeline(html: string): Declared {
  const found: Script[] = [];
  for (const script of scripts(html)) if (script.attributes.get('id') === TIMELINE_ELEMENT) found.push(script);
  const [declaration, second] = found;
  if (declaration === undefined) return { timeline: null, problem: null };
  if (second !== undefined) return refused('stands twice; keep one');
  if (declaration.attributes.get('type')?.trim().toLowerCase() !== 'application/json')
    return refused('must be a <script type="application/json">');
  let parsed: unknown;
  try {
    parsed = JSON.parse(declaration.body);
  } catch (failure) {
    return refused(`is not JSON: ${failure instanceof Error ? failure.message : String(failure)}`);
  }
  const decoded = decodeTimeline(parsed, { onExcessProperty: 'error', errors: 'all' });
  return Result.isSuccess(decoded)
    ? { timeline: decoded.success, problem: null }
    : refused(`is out of bounds: ${decoded.failure.message.replace(/\n\s+at /g, ' at ').replace(/\n/g, '; ')}`);
}
