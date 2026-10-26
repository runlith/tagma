<script lang="ts">
  import type { BlockRead } from '@tagma/server/graph/contract/wire/rows';
  import { edgeKindOf, edgeTargetsOf, type FieldType, type Tag } from '@tagma/server/graph/contract/wire/tags/declaration';
  import { TagCatalog } from '$lib/features/graph/TagCatalog.svelte.js';

  let { read }: { read: BlockRead } = $props();

  const tags = TagCatalog.use();

  const typeWord = (type: FieldType): string => {
    if (typeof type === 'string') return type;
    if (type.type === 'enum') return type.values.join(' | ');
    if (type.type === 'schema') return `${type.name} document`;
    const target = type.tag === undefined ? 'block' : `#${tags.table.nameOf(type.tag)}`;
    return type.many === true ? `list of ${target}` : target;
  };

  const valueWord = (value: unknown): string =>
    typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : Array.isArray(value) && value.every((item) => typeof item === 'string')
        ? value.join(', ')
        : JSON.stringify(value);

  const carried = $derived(tags.table.tagsOf(read));

  const bound = $derived(
    new Set(carried.flatMap((tag) => Object.values(tag.contracts ?? {}).flatMap((binding) => Object.values(binding.slots)))),
  );

  const values = $derived.by(() => {
    if (read.tags.includes('tag')) return [];
    const rows: { name: string; value: string }[] = [];
    for (const [key, value] of Object.entries(read.fields)) {
      if (value === undefined || value === null || bound.has(key)) continue;
      const declaring = carried.find((tag) => tag.fields[key] !== undefined);
      if (declaring === undefined) continue;
      const type = declaring.fields[key]!;
      if (typeof type === 'object' && type.type === 'schema') continue;
      rows.push({ name: tags.table.fieldNameOf(declaring.id, key), value: valueWord(value) });
    }
    return rows;
  });

  const declared = $derived.by((): Tag | null => {
    if (!read.tags.includes('tag') || typeof read.fields.id !== 'string') return null;
    return tags.table.tagById(read.fields.id);
  });

  const required = $derived(new Set((declared?.gates ?? []).flatMap((gate) => (gate.gate === 'required' ? [gate.field] : []))));

  const findings = $derived(tags.findings.filter((finding) => finding.name === read.name));
</script>

{#if findings.length > 0}
  <ul class="mt-5 space-y-1.5 text-ui">
    {#each findings as finding (finding.kind)}
      <li><span class="eyebrow text-muted-foreground">{finding.kind}</span> {finding.text}</li>
    {/each}
  </ul>
{/if}

{#if values.length > 0}
  <dl class="mt-5 grid grid-cols-[max-content_1fr] items-baseline gap-x-4 gap-y-1.5 text-ui">
    {#each values as row (row.name)}
      <dt class="eyebrow text-muted-foreground">{row.name}</dt>
      <dd>{row.value}</dd>
    {/each}
  </dl>
{/if}

{#if declared}
  <dl class="mt-5 grid grid-cols-[max-content_1fr] items-baseline gap-x-4 gap-y-1.5 text-ui">
    {#if declared.extends}
      <dt class="eyebrow text-muted-foreground">Extends</dt>
      <dd><code class="text-ui">#{tags.table.nameOf(declared.extends)}</code></dd>
    {/if}
    {#each Object.entries(declared.fields) as [key, type] (key)}
      <dt class="eyebrow text-muted-foreground">{tags.table.fieldNameOf(declared.id, key)}</dt>
      <dd>
        <code class="text-ui">{typeWord(type)}</code>
        {#if required.has(key)}<span class="text-muted-foreground"> · required</span>{/if}
      </dd>
    {/each}
    {#if declared.edges.length > 0}
      <dt class="eyebrow text-muted-foreground">Edges</dt>
      <dd>
        {#each declared.edges as edge, index (edgeKindOf(edge))}
          {@const targets = edgeTargetsOf(edge)}
          <code class="text-ui"
            >{edgeKindOf(edge)}{targets === null ? '' : ` → ${targets.map((target) => `#${tags.table.nameOf(target)}`).join(' | ')}`}</code
          >{index < declared.edges.length - 1 ? ', ' : ''}
        {/each}
      </dd>
    {/if}
  </dl>
{/if}
