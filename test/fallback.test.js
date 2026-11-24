import { describe, expect, it } from 'vitest';
import { buildFallbackPlan } from '../src/lib/fallback.js';
import { normalisePlan } from '../src/lib/plan.js';
import { OPTIONS, validatePlanRequest } from '../src/lib/validate.js';
import { validAnswers } from './helpers.js';

const severeAir = {
  aqi: 312,
  label: 'Hazardous',
  advice: 'Avoid going out.',
  peak: { time: '2026-11-23T21:00', aqi: 365 },
};
const cleanAir = { aqi: 35, label: 'Good', advice: 'Air is clean.', peak: null };

const answers = (overrides = {}) => validatePlanRequest({ ...validAnswers, ...overrides });
const titles = (list) => list.map((entry) => entry.title).join(' | ');

describe('buildFallbackPlan', () => {
  it('produces a plan that passes the same checks as a model plan', () => {
    for (const commute of OPTIONS.commute) {
      for (const cookingFuel of OPTIONS.cookingFuel) {
        const plan = buildFallbackPlan(answers({ commute, cookingFuel }), severeAir, 'Delhi');
        expect(normalisePlan(plan)).not.toBeNull();
      }
    }
  });

  it('states the reading, the peak hour and the vulnerable household in the summary', () => {
    const { summary } = buildFallbackPlan(answers(), severeAir, 'Delhi');
    expect(summary).toContain('AQI 312');
    expect(summary).toContain('21:00');
    expect(summary).toContain('most vulnerable');
  });

  it('keeps the summary light on a clean day', () => {
    const plan = buildFallbackPlan(answers({ household: [] }), cleanAir, 'Shimla');
    expect(plan.summary).not.toContain('most vulnerable');
    expect(plan.routine[0].title).toBe('Keep outdoor time flexible');
  });

  it('tailors the commute and cooking swaps', () => {
    const plan = buildFallbackPlan(answers({ commute: 'two_wheeler', cookingFuel: 'biomass' }), severeAir, 'Patna');
    expect(titles(plan.alternatives)).toContain('two wheeler');
    expect(titles(plan.alternatives)).toContain('wood or dung');
  });

  it('adds clean air breaks for long outdoor hours', () => {
    expect(titles(buildFallbackPlan(answers({ outdoorTime: 'over_3h' }), severeAir, 'Delhi').routine)).toContain(
      'clean air breaks',
    );
    expect(titles(buildFallbackPlan(answers({ household: ['outdoor_worker'] }), severeAir, 'Delhi').routine)).toContain(
      'clean air breaks',
    );
    expect(titles(buildFallbackPlan(answers(), severeAir, 'Delhi').routine)).not.toContain('clean air breaks');
  });

  it('fits indoor advice to the purifier and the budget', () => {
    expect(titles(buildFallbackPlan(answers({ hasPurifier: true }), severeAir, 'Delhi').indoor)).toContain(
      'Run the purifier',
    );
    expect(titles(buildFallbackPlan(answers({ budget: 'low' }), severeAir, 'Delhi').indoor)).toContain(
      'Make one clean room',
    );
    expect(titles(buildFallbackPlan(answers({ budget: 'none' }), severeAir, 'Delhi').indoor)).toContain(
      'Seal one bedroom',
    );
  });

  it('tags every item with a cost and a benefit, and never asks a zero budget home to spend much', () => {
    const plan = buildFallbackPlan(answers({ budget: 'none' }), severeAir, 'Delhi');
    const indoor = plan.indoor.map((entry) => entry.cost);
    expect(indoor).not.toContain('medium');
    for (const entry of [...plan.routine, ...plan.indoor, ...plan.alternatives]) {
      expect(['free', 'low', 'medium']).toContain(entry.cost);
      expect(['high', 'medium', 'low']).toContain(entry.benefit);
    }
  });

  it('explains the impact of every single item', () => {
    const plan = buildFallbackPlan(answers(), severeAir, 'Delhi');
    for (const entry of [...plan.routine, ...plan.indoor, ...plan.alternatives]) {
      expect(entry.impact.length).toBeGreaterThan(20);
    }
  });
});
