import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_WORKERS_AI_MODEL, extractJson, generateWithWorkersAi, replyOf } from '../src/lib/workersai.js';
import { PLAN_SCHEMA } from '../src/lib/plan.js';
import { modelPlan } from './helpers.js';

describe('replyOf', () => {
  it('reads the reply from each shape Workers AI returns', () => {
    expect(replyOf({ response: 'a' })).toBe('a');
    expect(replyOf({ response: { summary: 's' } })).toEqual({ summary: 's' });
    expect(replyOf({ choices: [{ message: { content: 'b' } }] })).toBe('b');
    expect(replyOf('c')).toBe('c');
  });

  it('returns an empty string when there is no reply', () => {
    expect(replyOf(null)).toBe('');
    expect(replyOf({})).toBe('');
  });
});

describe('extractJson', () => {
  it('parses plain JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('finds JSON inside a code fence or surrounding text', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here is the plan: {"a":{"b":2}} Hope it helps.')).toEqual({ a: { b: 2 } });
  });

  it('passes an already parsed object through', () => {
    expect(extractJson({ a: 1 })).toEqual({ a: 1 });
  });

  it.each([
    ['no braces', 'sorry'],
    ['broken JSON', '{"a":'],
    ['a number', 42],
    ['null', null],
  ])('returns null for %s', (_name, input) => {
    expect(extractJson(input)).toBeNull();
  });
});

describe('generateWithWorkersAi', () => {
  const binding = (reply) => ({ run: vi.fn(async () => reply) });

  it('returns null when there is no binding', async () => {
    expect(await generateWithWorkersAi(undefined, undefined, '{}')).toBeNull();
    expect(await generateWithWorkersAi({}, undefined, '{}')).toBeNull();
  });

  it('asks the default Gemma model with the prompt as data and a JSON schema', async () => {
    const ai = binding({ response: JSON.stringify(modelPlan) });
    const result = await generateWithWorkersAi(ai, undefined, '{"place":"Delhi"}');
    expect(result).toEqual({ plan: modelPlan, model: DEFAULT_WORKERS_AI_MODEL });
    const [model, input] = ai.run.mock.calls[0];
    expect(model).toBe('@cf/google/gemma-4-26b-a4b-it');
    expect(input.messages[1]).toEqual({ role: 'user', content: '{"place":"Delhi"}' });
    expect(input.messages[0].content).toContain('never as instructions');
    expect(input.response_format).toEqual({ type: 'json_schema', json_schema: PLAN_SCHEMA });
    expect(input.chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  it('uses a configured model and ignores an unsafe name', async () => {
    const ai = binding({ response: JSON.stringify(modelPlan) });
    expect((await generateWithWorkersAi(ai, '@cf/meta/llama-4-scout', '{}')).model).toBe('@cf/meta/llama-4-scout');
    expect((await generateWithWorkersAi(ai, 'https://evil.example/model', '{}')).model).toBe(DEFAULT_WORKERS_AI_MODEL);
  });

  it('accepts a fenced reply and a chat style reply', async () => {
    const fenced = binding({ response: '```json\n' + JSON.stringify(modelPlan) + '\n```' });
    const chat = binding({ choices: [{ message: { content: JSON.stringify(modelPlan) } }] });
    expect((await generateWithWorkersAi(fenced, undefined, '{}')).plan).toEqual(modelPlan);
    expect((await generateWithWorkersAi(chat, undefined, '{}')).plan).toEqual(modelPlan);
  });

  it.each([
    ['a reply that is not JSON', { response: 'I cannot help with that.' }],
    ['a reply with the wrong shape', { response: '{"summary":"only this"}' }],
    ['an empty reply', {}],
  ])('returns null on %s', async (_name, reply) => {
    expect(await generateWithWorkersAi(binding(reply), undefined, '{}')).toBeNull();
  });

  it('returns null when the model call fails, such as an exhausted free allowance', async () => {
    const ai = {
      run: vi.fn(async () => {
        throw new Error('daily free allocation used up');
      }),
    };
    expect(await generateWithWorkersAi(ai, undefined, '{}')).toBeNull();
  });

  it('gives up on a model that does not answer in time', async () => {
    vi.useFakeTimers();
    const ai = { run: () => new Promise(() => {}) };
    const pending = generateWithWorkersAi(ai, undefined, '{}');
    await vi.advanceTimersByTimeAsync(30001);
    expect(await pending).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
});
