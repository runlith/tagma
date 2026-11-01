import { App } from '@runlith/layer/App';
import { LADDER } from './composition.js';
import { WINDOW } from './window.js';

export const runtime = App.define(WINDOW, { ladder: LADDER });
