import { Schema } from 'effect';
import { arms, operation } from '../../../platform/contract/wire/operation.js';
import { ProfileId } from './ids.js';
import { ConsoleCapture, Profile, ProfileName } from './profile.js';
import { MACHINE_ACTING, MACHINE_READING } from './shape.js';

const profile = ProfileId.annotate({ description: 'The profile id list_profiles answered.' });

export const PROFILE_OPERATIONS = {
  list_profiles: operation('list_profiles', {
    ...MACHINE_READING,
    meaning: 'List the browser profiles of this machine: name, host adapter, console capture, and whether its host is connected now.',
    grammar:
      'A profile keeps its own cookies, storage and identity and stays bound to the host adapter it was made for. `removal` names a delete or clear waiting for its host to connect.',
    input: Schema.Struct({}),
    answer: arms({ listed: { profiles: Schema.Array(Profile) } }),
    refusals: [],
    confirmation: () => ({ summary: 'List the browser profiles?' }),
    confirmLabel: 'List profiles',
    presentation: { running: 'Listing the profiles', done: 'Listed the profiles' },
  }),
  create_profile: operation('create_profile', {
    ...MACHINE_ACTING,
    meaning: 'Make a browser profile on one host adapter.',
    grammar:
      '`adapter` is one list_profiles shows, or one of this server; `document` is what that adapter keeps about the profile and it checks it. `console` defaults to `auto`.',
    input: Schema.Struct({
      name: ProfileName,
      adapter: Schema.String.check(Schema.isMinLength(1)),
      document: Schema.optional(Schema.Unknown),
      console: Schema.optional(ConsoleCapture),
    }),
    answer: arms({ created: { profile: Profile } }),
    refusals: ['adapter-unknown', 'document-invalid'],
    confirmation: (input) => ({ summary: `Make the profile ${input.name}?` }),
    confirmLabel: 'Make profile',
    presentation: { running: 'Making the profile', done: 'Made the profile' },
  }),
  update_profile: operation('update_profile', {
    ...MACHINE_ACTING,
    meaning: 'Rename a browser profile or change its console capture.',
    input: Schema.Struct({ profile, name: Schema.optional(ProfileName), console: Schema.optional(ConsoleCapture) }),
    answer: arms({ updated: { profile: Profile } }),
    refusals: ['profile-unknown'],
    confirmation: () => ({ summary: 'Change the profile?' }),
    confirmLabel: 'Change profile',
    presentation: { running: 'Changing the profile', done: 'Changed the profile' },
  }),
  delete_profile: operation('delete_profile', {
    ...MACHINE_ACTING,
    intent: 'destructive',
    destructiveConsequence: (input) => `Profile ${input.profile}, its pages, cookies and storage are removed.`,
    meaning: 'Delete a browser profile with its pages and storage.',
    grammar: 'While its host is not connected the profile is marked and its storage is removed when the host connects; `pending` says so.',
    input: Schema.Struct({ profile }),
    answer: arms({ deleted: { profile: ProfileId, pending: Schema.Boolean } }),
    refusals: ['profile-unknown'],
    confirmation: (input) => ({ summary: `Delete the profile ${input.profile}?` }),
    confirmLabel: 'Delete profile',
    presentation: { running: 'Deleting the profile', done: 'Deleted the profile' },
  }),
  clear_profile: operation('clear_profile', {
    ...MACHINE_ACTING,
    intent: 'destructive',
    destructiveConsequence: (input) => `The cookies, storage and cache of profile ${input.profile} are removed; its open pages close.`,
    meaning: 'Clear the cookies, storage and cache of a browser profile and keep the profile.',
    grammar: 'Its open pages close first. While its host is not connected the clearing waits for the host; `pending` says so.',
    input: Schema.Struct({ profile }),
    answer: arms({ cleared: { profile: ProfileId, pending: Schema.Boolean } }),
    refusals: ['profile-unknown'],
    confirmation: (input) => ({ summary: `Clear the profile ${input.profile}?` }),
    confirmLabel: 'Clear profile',
    presentation: { running: 'Clearing the profile', done: 'Cleared the profile' },
  }),
};

export type ProfileOperationId = keyof typeof PROFILE_OPERATIONS;
