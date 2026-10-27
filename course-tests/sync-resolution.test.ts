import { deduplicateOperations, resolveSync } from '../src/course-evaluation';

describe('resolveSync', () => {
  test('merges additions and deletions when they affect independent fields', () => {
    const base = { id: 'incident-1', version: 1, fields: { title: 'Lamp', priority: 1, room: 'A' } };
    const local = { ...base, fields: { title: 'Lamp', priority: 2 } };
    const remote = { ...base, version: 2, fields: { title: 'Ceiling lamp', priority: 1, room: 'A' } };

    expect(resolveSync(base, local, remote)).toEqual({
      kind: 'merged',
      fields: { title: 'Ceiling lamp', priority: 2 },
    });
  });

  test('treats equivalent nested JSON values as equal changes', () => {
    const base = { id: 'incident-1', version: 1, fields: { details: { room: 'A', tags: ['light'] } } };
    const local = { ...base, fields: { details: { room: 'B', tags: ['light'] } } };
    const remote = {
      ...base,
      version: 2,
      fields: { details: { tags: ['light'], room: 'B' } },
    };

    expect(resolveSync(base, local, remote)).toEqual({
      kind: 'merged',
      fields: { details: { room: 'B', tags: ['light'] } },
    });
  });

  test('reports every conflicting top-level field in sorted order without mutating inputs', () => {
    const base = { id: 'incident-1', version: 1, fields: { title: 'Lamp', priority: 1 } };
    const local = { ...base, fields: { title: 'Desk lamp', priority: 2 } };
    const remote = { ...base, version: 2, fields: { title: 'Ceiling lamp', priority: 3 } };
    const before = JSON.stringify([base, local, remote]);

    expect(resolveSync(base, local, remote)).toEqual({
      kind: 'conflict',
      fields: ['priority', 'title'],
    });
    expect(JSON.stringify([base, local, remote])).toBe(before);
  });

  test('returns an unchanged record as a merged copy', () => {
    const base = { id: 'incident-1', version: 1, fields: { title: 'Lamp' } };

    expect(resolveSync(base, base, base)).toEqual({
      kind: 'merged',
      fields: { title: 'Lamp' },
    });
  });
});

describe('deduplicateOperations', () => {
  test('keeps the first object for each operationId and preserves order', () => {
    const first = { operationId: 'op-1', value: 'first' };
    const repeated = { operationId: 'op-1', value: 'repeat' };
    const second = { operationId: 'op-2', value: 'second' };
    const input = [first, repeated, second];

    expect(deduplicateOperations(input)).toEqual([first, second]);
    expect(deduplicateOperations(input)[0]).toBe(first);
    expect(input).toEqual([first, repeated, second]);
  });

  test('returns an empty list for empty input', () => {
    expect(deduplicateOperations([])).toEqual([]);
  });
});
