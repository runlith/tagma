import { WebSearchSessions } from '@runlith/agent-tools/WebSearchSessions';
import { Effect, Layer } from 'effect';
import { WebSearch } from '../contract/service/webSearch.js';

export const webSearchLayer: Layer.Layer<WebSearch> = Layer.effect(WebSearch, Effect.suspend(WebSearchSessions.make));
