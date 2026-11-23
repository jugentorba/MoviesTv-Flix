#!/usr/bin/env node
/**
 * Proves the sync schema is user-isolated, against a real Supabase project.
 *
 * This is not a unit test: it talks to the network and it creates two throwaway
 * anonymous users. Run it after applying migrations, or after any change to an
 * RLS policy.
 *
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_PUBLISHABLE_KEY=sb_publishable_... \
 *   node apps/mobile-tv/scripts/verify-rls.mjs
 *
 * It only ever uses the publishable key, so it can also be run from a device
 * build. It prints one PASS/FAIL line per check and exits non-zero on failure.
 * Test rows are deleted at the end; the anonymous users remain, because an
 * anonymous user cannot delete itself with the publishable key.
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL?.trim();
const key = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();

if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.');
  process.exit(2);
}
if (/^sb_secret_/i.test(key) || /service[-_]?role/i.test(key)) {
  console.error('Refusing to run with a secret key: this check must prove RLS, not bypass it.');
  process.exit(2);
}

const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const newClient = () => createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const a = newClient();
const { data: signA, error: signAError } = await a.auth.signInAnonymously();
record('anonymous sign-in works', !signAError && Boolean(signA?.user), signAError?.message ?? '');
if (!signA?.user) {
  console.error('\nCannot continue without an anonymous session.');
  process.exit(1);
}
const userA = signA.user.id;

const { error: insertAError } = await a
  .from('user_preferences')
  .upsert({ user_id: userA, app_locale: 'sq' }, { onConflict: 'user_id' });
record('owner can write its own row', !insertAError, insertAError?.message ?? '');

const { data: readA, error: readAError } = await a
  .from('user_preferences')
  .select('user_id, app_locale');
record(
  'owner reads exactly its own row',
  !readAError && readA?.length === 1 && readA[0].user_id === userA,
  readAError?.message ?? `rows=${readA?.length}`,
);

const b = newClient();
const { data: signB, error: signBError } = await b.auth.signInAnonymously();
record('a second user can sign in', !signBError && Boolean(signB?.user), signBError?.message ?? '');

const { data: readB, error: readBError } = await b
  .from('user_preferences')
  .select('user_id, app_locale');
record(
  'another user CANNOT read the owner row',
  !readBError && Array.isArray(readB) && readB.length === 0,
  readBError?.message ?? `rows=${readB?.length}`,
);

const { error: spoofError } = await b
  .from('user_preferences')
  .upsert({ user_id: userA, app_locale: 'fr' }, { onConflict: 'user_id' });
record(
  'another user CANNOT insert into the owner row',
  Boolean(spoofError),
  spoofError ? `${spoofError.code ?? ''} ${spoofError.message}` : 'write was accepted',
);

const { error: updateError } = await b
  .from('user_preferences')
  .update({ app_locale: 'de' })
  .eq('user_id', userA);
const { data: afterUpdate } = await a.from('user_preferences').select('app_locale').single();
record(
  'another user CANNOT update the owner row',
  Boolean(updateError) || afterUpdate?.app_locale === 'sq',
  updateError?.message ?? 'row unchanged',
);

const anon = newClient();
const { data: anonData, error: anonError } = await anon
  .from('user_preferences')
  .select('user_id');
record(
  'no session gets nothing',
  Boolean(anonError) || (Array.isArray(anonData) && anonData.length === 0),
  anonError ? `${anonError.code ?? ''} ${anonError.message}` : `rows=${anonData?.length}`,
);

for (const table of ['user_addons', 'user_watch_progress']) {
  const { error } = await b.from(table).select('user_id').limit(1);
  record(`${table} exists and is readable by its owner`, !error, error?.message ?? '');
}

const { error: cleanupError } = await a
  .from('user_preferences')
  .delete()
  .eq('user_id', userA);
record('test row cleaned up', !cleanupError, cleanupError?.message ?? '');

await a.auth.signOut();
await b.auth.signOut();

const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
