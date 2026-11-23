import { maskEmail } from '../maskEmail';

test('keeps the domain and hides the local part', () => {
  expect(maskEmail('jugen@example.com')).toBe('j***@example.com');
  expect(maskEmail('a@b.co')).toBe('a***@b.co');
  expect(maskEmail('  spaced@example.com  ')).toBe('s***@example.com');
});

test('degrades safely for odd input', () => {
  expect(maskEmail('')).toBeNull();
  expect(maskEmail(null)).toBeNull();
  expect(maskEmail('no-at-sign')).toBe('n***');
  expect(maskEmail('@nolocal.com')).toBe('***');
});
