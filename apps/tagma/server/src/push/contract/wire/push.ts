import { Schema } from 'effect';
import { arms, operation } from '../../../platform/contract/wire/operation.js';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../../../platform/contract/wire/conditions.js';

export const NOTICE_BYTES = 3072;

export const notificationTag = (id: string): string => `notification:${id}`;

export const Notice = Schema.Struct({
  title: Schema.String,
  body: Schema.String,
  url: Schema.String,
  tag: Schema.String,
  badge: Schema.Int,
});
export type Notice = typeof Notice.Type;

export const Subscription = Schema.Struct({
  endpoint: Schema.String.annotate({ description: 'The push service URL PushSubscription.endpoint answered.' }),
  p256dh: Schema.String.annotate({ description: "The browser's P-256 public key, base64url, from PushSubscription.toJSON().keys." }),
  auth: Schema.String.annotate({ description: 'The 16-byte auth secret, base64url, from PushSubscription.toJSON().keys.' }),
});
export type Subscription = typeof Subscription.Type;

const deviceOnly = {
  doors: { http: 'perform' },
  callers: 'operator',
  subject: 'none',
  place: 'machine',
  waits: [],
  lifetimes: [],
} as const;
const nobody = () => [];

export const PUSH_OPERATIONS = {
  read_push_status: operation('read_push_status', {
    approval: ASKS_NEVER,
    ...deviceOnly,
    meaning:
      'Read the key a browser subscribes with, the push subscription of the device asking, the last delivery problem its push service answered and which paired devices are subscribed.',
    grammar:
      '`key` is null while push cannot run on this server, and `problem` then says why; `device` is the paired device asking, null from any other caller; `endpoint` is null while that device holds no subscription.',
    input: Schema.Struct({}),
    answer: arms({
      read: {
        key: Schema.NullOr(Schema.String),
        device: Schema.NullOr(Schema.String),
        endpoint: Schema.NullOr(Schema.String),
        problem: Schema.NullOr(Schema.String),
        devices: Schema.Array(Schema.String),
      },
    }),
    refusals: [],
    effect: 'read',
    identity: 'none',
    subjects: nobody,
    confirmation: () => ({ summary: 'Read push notifications?' }),
    confirmLabel: 'Read push',
    presentation: { running: 'Reading push notifications', done: 'Read push notifications' },
  }),
  subscribe_push: operation('subscribe_push', {
    approval: ASKS_IN_REVIEW,
    ...deviceOnly,
    meaning:
      'Have this paired device notified when an agent waits for the operator, fails or finishes; its earlier subscription is replaced.',
    input: Subscription,
    answer: arms({ subscribed: {} }),
    refusals: ['device-required', 'push-unavailable', 'bad-subscription'],
    effect: 'write',
    identity: { key: 'request' },
    subjects: nobody,
    confirmation: () => ({ summary: 'Turn on notifications for this device?' }),
    confirmLabel: 'Turn on notifications',
    presentation: { running: 'Turning on notifications', done: 'Turned on notifications' },
  }),
  unsubscribe_push: operation('unsubscribe_push', {
    approval: ASKS_IN_REVIEW,
    ...deviceOnly,
    meaning: 'Stop notifying this paired device.',
    input: Schema.Struct({}),
    answer: arms({ unsubscribed: {} }),
    refusals: ['device-required'],
    effect: 'write',
    identity: { key: 'request' },
    subjects: nobody,
    confirmation: () => ({ summary: 'Turn off notifications for this device?' }),
    confirmLabel: 'Turn off notifications',
    presentation: { running: 'Turning off notifications', done: 'Turned off notifications' },
  }),
};

export type PushOperationId = keyof typeof PUSH_OPERATIONS;
