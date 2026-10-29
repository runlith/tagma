import { toolPageText } from '@runlith/agent/tool/page';
import type { ToolDisplay } from '@runlith/agent/tool/display';
import { underParent } from '../graph/voice/lines.js';
import { provenanceLine } from '../platform/contract/wire/provenance.js';
import type { ReflectionFiled, ReflectionList } from './contract/wire/answers.js';

const sightings = (count: number): string => `${count} ${count === 1 ? 'sighting' : 'sightings'}`;

export function filedText(result: ReflectionFiled): string {
  return [
    `${result.block.name} ${result.block.title}${underParent(result.block.parentName)}`,
    ...(result.unplaced === undefined ? [] : [result.unplaced]),
    ...(result.body ?? []),
    `${sightings(result.sightings)} on record`,
    ...(result.receivedBy === null ? [] : [`received by a server ${provenanceLine(result.receivedBy)}`]),
    ...(result.already.length === 0
      ? []
      : [`already on record: ${result.already.map((echo) => `${echo.name} ${echo.title} (shared ${echo.shared})`).join(', ')}`]),
  ].join('\n');
}

export function filedDisplay(result: ReflectionFiled): ToolDisplay {
  return {
    form: 'none',
    title: `${result.block.name} ${result.block.title}`,
    facts: result.already.length === 0 ? [] : [{ label: 'already', value: String(result.already.length) }],
  };
}

export function standingDisplay(result: ReflectionList): ToolDisplay {
  return { form: 'none', facts: [{ label: 'standing', value: `${result.shown} of ${result.total}` }] };
}

export function standingText(result: ReflectionList): string {
  return toolPageText({
    rows: result.blocks.map((row) => ({ label: `${row.name} ${row.title} · ${sightings(row.sightings)}${underParent(row.parentName)}` })),
    total: result.total,
    order: 'newest first',
    next: result.next === null ? undefined : `read_reflections(cursor="${result.next}")`,
    empty: 'no standing friction',
  });
}
