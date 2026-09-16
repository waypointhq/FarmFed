import { shuffleWithSeed } from './CategoryRows';

const categories = ['meat', 'eggs', 'produce', 'baked', 'dairy', 'honey'];

describe('shuffleWithSeed()', () => {
  it('is stable for a given seed', () => {
    expect(shuffleWithSeed(categories, 20260916)).toEqual(shuffleWithSeed(categories, 20260916));
  });

  it('produces a different order for a different seed', () => {
    const today = shuffleWithSeed(categories, 20260916);
    const tomorrow = shuffleWithSeed(categories, 20260917);
    expect(today).not.toEqual(tomorrow);
  });

  it('keeps every category exactly once', () => {
    const shuffled = shuffleWithSeed(categories, 12345);
    expect([...shuffled].sort()).toEqual([...categories].sort());
  });

  it('does not mutate the input', () => {
    const input = [...categories];
    shuffleWithSeed(input, 7);
    expect(input).toEqual(categories);
  });

  it('handles empty and single-item lists', () => {
    expect(shuffleWithSeed([], 1)).toEqual([]);
    expect(shuffleWithSeed(['meat'], 1)).toEqual(['meat']);
  });

  it('gives every category a turn near the top across a fortnight', () => {
    // The point of the shuffle: nobody is permanently stuck at the bottom.
    const seenInTopTwo = new Set();
    for (let day = 0; day < 14; day++) {
      shuffleWithSeed(categories, 20260900 + day)
        .slice(0, 2)
        .forEach(c => seenInTopTwo.add(c));
    }
    expect(seenInTopTwo.size).toBe(categories.length);
  });
});
