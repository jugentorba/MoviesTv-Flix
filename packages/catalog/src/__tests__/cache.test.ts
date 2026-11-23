import { MemoryCatalogCache } from '../cache';

test('bounds catalog cache entries and evicts the least recently used key', async () => {
  const cache = new MemoryCatalogCache(2);

  await cache.set('one', { value: 1 }, 1_000, 0);
  await cache.set('two', { value: 2 }, 1_000, 0);

  await expect(cache.get<{ value: number }>('one', 1))
    .resolves.toEqual({
      value: { value: 1 },
      stale: false,
    });

  await cache.set('three', { value: 3 }, 1_000, 0);

  await expect(cache.get('two', 1)).resolves.toBeNull();
  await expect(cache.get('one', 1)).resolves.toEqual({
    value: { value: 1 },
    stale: false,
  });
  await expect(cache.get('three', 1)).resolves.toEqual({
    value: { value: 3 },
    stale: false,
  });
});

test('preserves stale catalog fallback semantics inside the bounded cache', async () => {
  const cache = new MemoryCatalogCache(2);
  await cache.set('search:Dune', { items: ['cached'] }, 10, 100);

  await expect(cache.get('search:Dune', 111)).resolves.toEqual({
    value: { items: ['cached'] },
    stale: true,
  });
});

test('normalizes invalid catalog cache capacity to a usable minimum', async () => {
  const cache = new MemoryCatalogCache(0);

  await cache.set('one', 1, 100, 0);
  await cache.set('two', 2, 100, 0);

  await expect(cache.get('one', 1)).resolves.toBeNull();
  await expect(cache.get('two', 1)).resolves.toEqual({
    value: 2,
    stale: false,
  });
});
