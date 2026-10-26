import { Schema } from 'effect';
import { ContentBlock, Meta, Text } from './content';
import { ToolCall, ToolCallUpdate } from './toolCalls';

export const SessionMode = Schema.Struct({ id: Schema.String, name: Schema.String, description: Text, _meta: Meta });

export const SessionModeState = Schema.Struct({
  currentModeId: Schema.String,
  availableModes: Schema.Array(SessionMode),
  _meta: Meta,
});
export type SessionModeState = typeof SessionModeState.Type;

const SelectOption = Schema.Struct({ value: Schema.String, name: Schema.String, description: Text, _meta: Meta });

const SelectGroup = Schema.Struct({ group: Schema.String, name: Schema.String, options: Schema.Array(SelectOption), _meta: Meta });

const ConfigOptionFields = {
  id: Schema.String,
  name: Schema.String,
  description: Text,
  category: Text,
  _meta: Meta,
};

export const SessionConfigOption = Schema.Union([
  Schema.Struct({
    ...ConfigOptionFields,
    type: Schema.Literal('select'),
    currentValue: Schema.String,
    options: Schema.Union([Schema.Array(SelectOption), Schema.Array(SelectGroup)]),
  }),
  Schema.Struct({ ...ConfigOptionFields, type: Schema.Literal('boolean'), currentValue: Schema.Boolean }),
]);
export type SessionConfigOption = typeof SessionConfigOption.Type;

export const Cost = Schema.Struct({ amount: Schema.Number, currency: Schema.String, _meta: Meta });
export type Cost = typeof Cost.Type;

const PlanEntry = Schema.Struct({
  content: Schema.String,
  priority: Schema.Literals(['high', 'medium', 'low']),
  status: Schema.Literals(['pending', 'in_progress', 'completed']),
  _meta: Meta,
});

const AvailableCommand = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  input: Schema.optionalKey(Schema.NullOr(Schema.Struct({ hint: Schema.String, _meta: Meta }))),
  _meta: Meta,
});

const ChunkFields = { content: ContentBlock, messageId: Text, _meta: Meta };

export const SessionUpdate = Schema.Union([
  Schema.Struct({ sessionUpdate: Schema.Literal('user_message_chunk'), ...ChunkFields }),
  Schema.Struct({ sessionUpdate: Schema.Literal('agent_message_chunk'), ...ChunkFields }),
  Schema.Struct({ sessionUpdate: Schema.Literal('agent_thought_chunk'), ...ChunkFields }),
  Schema.Struct({ sessionUpdate: Schema.Literal('tool_call'), ...ToolCall.fields }),
  Schema.Struct({ sessionUpdate: Schema.Literal('tool_call_update'), ...ToolCallUpdate.fields }),
  Schema.Struct({ sessionUpdate: Schema.Literal('plan'), entries: Schema.Array(PlanEntry), _meta: Meta }),
  Schema.Struct({
    sessionUpdate: Schema.Literal('available_commands_update'),
    availableCommands: Schema.Array(AvailableCommand),
    _meta: Meta,
  }),
  Schema.Struct({ sessionUpdate: Schema.Literal('current_mode_update'), currentModeId: Schema.String, _meta: Meta }),
  Schema.Struct({ sessionUpdate: Schema.Literal('config_option_update'), configOptions: Schema.Array(SessionConfigOption), _meta: Meta }),
  Schema.Struct({ sessionUpdate: Schema.Literal('session_info_update'), title: Text, updatedAt: Text, _meta: Meta }),
  Schema.Struct({
    sessionUpdate: Schema.Literal('usage_update'),
    used: Schema.Number,
    size: Schema.Number,
    cost: Schema.optionalKey(Schema.NullOr(Cost)),
    _meta: Meta,
  }),
]);
export type SessionUpdate = typeof SessionUpdate.Type;

export const SessionNotification = Schema.Struct({ sessionId: Schema.String, update: SessionUpdate, _meta: Meta });
export type SessionNotification = typeof SessionNotification.Type;
