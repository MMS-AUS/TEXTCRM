import { describe, expect, it } from 'vitest';
import { inverterCapacityKw, leadSystemSchema } from './lead-details.ts';

const MODEL = '3f2b1c3e-8c55-4c5e-9b0f-2f6f3f4a1a11';

describe('inverters on a system', () => {
  it('adds up each model size times how many there are', () => {
    expect(
      inverterCapacityKw([
        { sizeKw: '5.000', count: 1 },
        { sizeKw: '8', count: 2 },
      ]),
    ).toBe('21.00');
    expect(inverterCapacityKw([])).toBe('0.00');
  });

  it('accepts a grid and a hybrid inverter, counting a blank quantity as one', () => {
    const result = leadSystemSchema.safeParse({
      inverters: [
        { inverterId: MODEL, count: '', type: 'grid' },
        { inverterId: MODEL, count: '2', type: 'hybrid' },
      ],
    });
    expect(result.success && result.data.inverters.map((row) => [row.count, row.type])).toEqual([
      [1, 'grid'],
      [2, 'hybrid'],
    ]);
  });

  it('asks for a model and a valid type', () => {
    const result = leadSystemSchema.safeParse({
      inverters: [{ inverterId: '', count: 1, type: 'solar' }],
    });
    expect(result.success).toBe(false);
    const messages = !result.success ? result.error.issues.map((issue) => issue.message) : [];
    expect(messages).toContain('Choose the inverter model.');
    expect(messages).toContain('Choose Grid or Hybrid.');
  });
});
