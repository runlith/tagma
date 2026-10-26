import type { ColumnDeclaration, ColumnsModule } from '$lib/features/workspace/column.js';

const modules = import.meta.glob<ColumnsModule>('../features/*/columns.ts', { eager: true });

export const DECLARED_COLUMNS: readonly ColumnDeclaration[] = Object.keys(modules)
  .sort()
  .flatMap((path) => modules[path]?.columns ?? []);
