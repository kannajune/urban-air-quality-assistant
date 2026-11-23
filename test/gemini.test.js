import { describe, expect, it } from 'vitest';
import { DEFAULT_MODELS, buildPrompt, generatePlan, modelChain } from '../src/lib/gemini.js';
import { normalisePlan } from '../src/lib/plan.js';
import { validatePlanRequest } from '../src/lib/validate.js';
import { fakeFetch, geminiReply, modelPlan, validAnswers } from './helpers.js';

const air = { aqi: 312, label: 'Hazardous', pm25: 210.4, pm10: 340.1, no2: 61.2, ozone: 12, measuredAt: '2026-11-23T09:00', peak: null };

describe('normalisePlan', () => {
  it('keeps a well formed plan', () => {
    expect(normalisePlan(modelPlan)).toEqual(modelPlan);
  });

  it('strips markup brackets and control characters from model text', () => {
    const plan = normalisePlan({ ...modelPlan, summary: 'Stay <b>inside</b>\u0007 today' });
    expect(plan.summary).toBe('Stay b inside /b today');
  });

  it('caps the number of items and the text length', () => {
    const many = Array.from({ length: 12 }, () => ({ title: 't', detail: 'd'.repeat(900), impact: 'i' }));
    const plan = normalisePlan({ ...modelPlan, routine: many });
    expect(plan.routine).toHaveLength(5);
    expect(plan.routine[0].detail).toHaveLength(320);
  });

  it('replaces unknown cost and benefit tags with the middle value', () => {
    const plan = normalisePlan({ ...modelPlan, routine: [{ title: 't', detail: 'd', impact: 'i', cost: 'gold', benefit: 9 }] });
    expect(plan.routine[0]).toMatchObject({ cost: 'low', benefit: 'medium' });
  });

  it('drops items with missing parts', () => {
    const plan = normalisePlan({ ...modelPlan, indoor: [{ title: 'No impact', detail: 'x' }, ...modelPlan.indoor] });
    expect(plan.indoor).toEqual(modelPlan.indoor);
  });

  it.each([
    ['null', null],
    ['a string', 'plan'],
    ['an array', []],
    ['a plan with no summary', { ...modelPlan, summary: '' }],
    ['a plan with an empty section', { ...modelPlan, routine: [] }],
    ['a plan with a missing section', { summary: 's', routine: modelPlan.routine }],
  ])('rejects %s', (_name, input) => {
    expect(normalisePlan(input)).toBeNull();
  });
});

describe('buildPrompt', () => {
  it('sends validated answers and readings as JSON data', () => {
    const prompt = JSON.parse(buildPrompt(validatePlanRequest(validAnswers), 'Delhi, India', air));
    expect(prompt.place).toBe('Delhi, India');
    expect(prompt.air_quality.us_aqi).toBe(312);
    expect(prompt.household).toEqual({
      vulnerable_members: ['children', 'asthma'],
      commute: 'car',
      cooking_fuel: 'lpg',
      daily_time_outdoors: '1_to_3h',
      has_air_purifier: false,
      budget_for_changes: 'low',
    });
  });
});

describe('modelChain', () => {
  it('reads a comma separated list in order and removes repeats', () => {
    expect(modelChain('gemini-3.5-flash, gemini-flash-latest,gemini-3.5-flash')).toEqual(['gemini-3.5-flash', 'gemini-flash-latest']);
  });

  it('drops unsafe names and caps the list at three', () => {
    expect(modelChain('../../evil?x=1,a-1,b-2,c-3,d-4')).toEqual(['a-1', 'b-2', 'c-3']);
  });

  it('uses the defaults when nothing valid is configured', () => {
    expect(modelChain(undefined)).toEqual(DEFAULT_MODELS);
    expect(modelChain('../../evil?x=1')).toEqual(DEFAULT_MODELS);
  });
});

describe('generatePlan', () => {
  it('returns null without calling the API when there is no key', async () => {
    const fetchImpl = fakeFetch({});
    expect(await generatePlan({ apiKey: '', fetchImpl }, '{}')).toBeNull();
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('sends the key in a header, never in the URL, and asks for structured JSON', async () => {
    const fetchImpl = fakeFetch({ generativelanguage: { body: geminiReply(modelPlan) } });
    const result = await generatePlan({ apiKey: 'secret-key', model: 'gemini-3.5-flash', fetchImpl }, '{"place":"Delhi"}');
    expect(result).toEqual({ plan: modelPlan, model: 'gemini-3.5-flash' });
    const [call] = fetchImpl.calls;
    expect(call.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent');
    expect(call.url).not.toContain('secret-key');
    expect(call.init.headers['x-goog-api-key']).toBe('secret-key');
    const body = JSON.parse(call.init.body);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.contents[0].parts[0].text).toBe('{"place":"Delhi"}');
  });

  it('moves on to the next model when the first is busy', async () => {
    const fetchImpl = fakeFetch({
      'busy-model': { status: 503 },
      'backup-model': { body: geminiReply(modelPlan) },
    });
    const result = await generatePlan({ apiKey: 'k', model: 'busy-model,backup-model', fetchImpl }, '{}');
    expect(result.model).toBe('backup-model');
    expect(fetchImpl.calls.map((call) => call.url.split('/models/')[1])).toEqual(['busy-model:generateContent', 'backup-model:generateContent']);
  });

  it('never puts an unsafe configured model name into the URL', async () => {
    const fetchImpl = fakeFetch({ generativelanguage: { body: geminiReply(modelPlan) } });
    await generatePlan({ apiKey: 'k', model: '../../evil?x=1', fetchImpl }, '{}');
    expect(fetchImpl.calls[0].url).toContain(`/models/${DEFAULT_MODELS[0]}:generateContent`);
  });

  it.each([
    ['an HTTP error', { status: 429 }],
    ['a reply with no candidates', { body: {} }],
    ['a reply that is not JSON', { body: { candidates: [{ content: { parts: [{ text: 'sorry' }] } }] } }],
    ['a reply with the wrong shape', { body: geminiReply({ summary: 'only this' }) }],
    ['a network failure', new Error('offline')],
  ])('returns null when every model gives %s', async (_name, route) => {
    const fetchImpl = fakeFetch({ generativelanguage: route });
    expect(await generatePlan({ apiKey: 'k', fetchImpl }, '{}')).toBeNull();
    expect(fetchImpl.calls).toHaveLength(DEFAULT_MODELS.length);
  });
});
