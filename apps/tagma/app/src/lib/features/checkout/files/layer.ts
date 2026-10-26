import { Layer } from '@runlith/layer/Layer';
import { AutoSave } from './AutoSave.svelte.js';
import { Column } from './Column.svelte.js';
import { Documents } from './Documents.svelte.js';
import { Explorer } from './Explorer.svelte.js';
import { FileOps } from './FileOps.svelte.js';
import { FileOpener } from './FileOpener.svelte.js';
import { EditorsRepo, Outside } from './Outside.svelte.js';
import { FileSearch } from './FileSearch.svelte.js';
import { Tabs } from './Tabs.svelte.js';

export const FilesLayer = Layer.mergeAll(
  AutoSave,
  FileOpener,
  EditorsRepo,
  Outside,
  Column,
  Tabs,
  Documents,
  Explorer,
  FileOps,
  FileSearch,
);
