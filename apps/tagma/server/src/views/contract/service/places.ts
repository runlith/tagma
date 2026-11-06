import { Context } from 'effect';

export class ViewPlaces extends Context.Service<ViewPlaces, { readonly home: string }>()('tagma/views/ViewPlaces') {}

export class ViewFiles extends Context.Service<
  ViewFiles,
  {
    module(plugin: string, key: string, file: string): string;
    sheet(file: string): string;
  }
>()('tagma/views/ViewFiles') {}
