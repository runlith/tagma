import { describe, expect, test } from 'bun:test';
import { Result } from 'effect';
import { userAnswerFromQuestion, userQuestionFromToolCall } from './UserQuestion';

const askedAt = new Date(0).toISOString();

describe('UserQuestion', () => {
  test('projects ask_user calls and answer notes into the tool result', () => {
    const questionPrompt = 'gender selection prompt';
    const question = userQuestionFromToolCall(
      {
        runId: 'run-1',
        toolCallId: 'tool-1',
        toolName: 'ask_user',
        input: {
          background: false,
          title: 'Learner profile',
          questions: [
            {
              prompt: questionPrompt,
              options: [
                { value: 'female', label: 'Female' },
                { value: 'male', label: 'Male' },
                { value: 'other', label: 'Other' },
              ],
            },
          ],
        },
      },
      askedAt,
    ).pipe(Result.getOrThrow);

    expect(question).toMatchObject({
      type: 'question',
      runId: 'run-1',
      questionId: 'tool-1',
      status: 'open',
      questions: [
        {
          id: 'tool-1',
          toolCallId: 'tool-1',
          header: 'Learner profile',
          prompt: questionPrompt,
          options: [
            { value: 'female', label: 'Female' },
            { value: 'male', label: 'Male' },
            { value: 'other', label: 'Other' },
          ],
        },
      ],
      toolCalls: [{ toolCallId: 'tool-1', toolName: 'ask_user' }],
    });

    expect(
      userAnswerFromQuestion(question!, 'tool-1', [
        {
          questionId: 'tool-1',
          values: ['male'],
          annotation: { notes: 'Use masculine Serbian forms.' },
        },
      ]),
    ).toEqual({
      status: 'answered',
      answers: [
        {
          questionId: 'tool-1',
          values: ['male'],
          notes: 'Use masculine Serbian forms.',
        },
      ],
    });
  });

  test('a secret prompt with no options is a question a reader can answer', () => {
    const question = userQuestionFromToolCall(
      {
        runId: 'run-1',
        toolCallId: 'tool-1',
        toolName: 'ask_user',
        input: { questions: [{ prompt: 'Paste the API key.', secret: true }] },
      },
      askedAt,
    ).pipe(Result.getOrThrow);

    expect(question).toMatchObject({
      questionId: 'tool-1',
      questions: [{ id: 'tool-1', prompt: 'Paste the API key.', secret: true }],
    });
  });
});
