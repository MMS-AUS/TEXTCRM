import { describe, expect, it } from 'vitest';
import { diff } from './audit.ts';

describe('diff', () => {
  it('treats lists with the same items as unchanged', () => {
    expect(diff({ extraEmails: ['a@x.example'] }, { extraEmails: ['a@x.example'] })).toBeNull();
    expect(diff({ extraEmails: [] }, { extraEmails: [] })).toBeNull();
  });

  it('reports a list that gained, lost or reordered items', () => {
    expect(diff({ extraEmails: [] }, { extraEmails: ['a@x.example'] })).toEqual({
      before: { extraEmails: [] },
      after: { extraEmails: ['a@x.example'] },
    });
    expect(diff({ tags: ['a', 'b'] }, { tags: ['b', 'a'] })).not.toBeNull();
  });
});
