import { Layer } from 'effect';
import { Film } from '../artifacts/contract/service/film.js';
import { Render } from '../artifacts/contract/service/render.js';
import { makeFilm } from './film.js';
import { makeRender } from './render.js';

const render = Layer.effect(Render, makeRender);

export const renderLayer = Layer.merge(render, Layer.effect(Film, makeFilm).pipe(Layer.provide(render)));
