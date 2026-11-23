import { createClient } from '@supabase/supabase-js';
import { SupabaseWatchProgressGateway } from '../SupabaseWatchProgressGateway';

function cloudHistory(count: number, failAfterFirstPage = false) {
  const requests: URL[] = [];
  const client = createClient('https://sync.example', 'public-test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input) => {
        const url = new URL(String(input));
        requests.push(url);
        const offset = Number(url.searchParams.get('offset') ?? 0);
        if (failAfterFirstPage && offset > 0) {
          return new Response(JSON.stringify({ message: 'page unavailable' }), {
            status: 400,
          });
        }
        const limit = Math.min(Number(url.searchParams.get('limit') ?? 1000), 1000);
        const rows = Array.from({ length: Math.max(0, Math.min(count - offset, limit)) }, (_, index) => ({
          media_id: `movie-${offset + index}`,
          kind: 'movie', title: 'Movie', position_seconds: 120,
          duration_seconds: 7200, completed: false,
          updated_at: '2026-09-27T10:00:00.000Z',
        }));
        return new Response(JSON.stringify(rows), { status: 200 });
      },
    },
  });
  return { gateway: new SupabaseWatchProgressGateway(client), requests };
}

test('loads history beyond the server response cap in stable user-scoped pages', async () => {
  const { gateway, requests } = cloudHistory(1501);
  const history = await gateway.list('user-1');
  expect(history).toHaveLength(1501);
  expect(history.at(-1)?.mediaId).toBe('movie-1500');
  expect(requests.length).toBeGreaterThan(1);
  for (const url of requests) {
    expect(url.searchParams.get('user_id')).toBe('eq.user-1');
    expect(url.searchParams.get('order')).toBe('updated_at.desc,media_id.asc');
  }
});

test('caps paginated history at the local storage capacity', async () => {
  const { gateway } = cloudHistory(2500);
  const history = await gateway.list('user-1');
  expect(history).toHaveLength(2000);
  expect(history.at(-1)?.mediaId).toBe('movie-1999');
});

test('rejects a later page failure instead of returning partial history', async () => {
  const { gateway } = cloudHistory(1501, true);
  await expect(gateway.list('user-1')).rejects.toThrow('page unavailable');
});
