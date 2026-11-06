import { Context } from 'effect';

export class ViewPlaces extends Context.Service<ViewPlaces, { readonly home: string }>()('tagma/views/ViewPlaces') {}

export class WindowStyles extends Context.Service<WindowStyles, { readonly utilities: string | null }>()('tagma/views/WindowStyles') {}

export class ViewFiles extends Context.Service<
  ViewFiles,
  {
    module(plugin: string, key: string, file: string): string;
    sheet(file: string): string;
  }
>()('tagma/views/ViewFiles') {}

export class ViewCandidates extends Context.Service<ViewCandidates, { readonly listed: () => readonly string[] }>()(
  'tagma/views/ViewCandidates',
) {}
