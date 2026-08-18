import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SignupDto } from './signup.dto';

async function errorsFor(overrides: Partial<Record<keyof SignupDto, unknown>>) {
  const base = {
    email: 'a@b.com',
    username: 'mazen',
    password: 'password123',
    displayName: 'Mazen',
    timezone: 'Africa/Cairo',
  };
  const dto = plainToInstance(SignupDto, { ...base, ...overrides });
  return validate(dto);
}

describe('SignupDto validation', () => {
  it('accepts a fully valid payload', async () => {
    expect(await errorsFor({})).toHaveLength(0);
  });

  describe('email', () => {
    it.each([
      'not-an-email',
      'missing-at-sign.com',
      '@nodomain',
      'spaces in@email.com',
      '',
    ])('rejects malformed email %p', async (value) => {
      expect(await errorsFor({ email: value })).not.toHaveLength(0);
    });
  });

  describe('username', () => {
    it.each(['ab', 'a'.repeat(21)])(
      'rejects out-of-range length %p',
      async (value) => {
        expect(await errorsFor({ username: value })).not.toHaveLength(0);
      },
    );

    it.each(['abc', 'a'.repeat(20)])(
      'accepts boundary-valid length %p',
      async (value) => {
        expect(await errorsFor({ username: value })).toHaveLength(0);
      },
    );

    it.each([
      'has space',
      'has-dash',
      'has.dot',
      'has@sign',
      "has'quote",
      '<script>alert(1)</script>',
      'emoji😀name',
      'null\0byte',
    ])('rejects disallowed characters in %p', async (value) => {
      expect(await errorsFor({ username: value })).not.toHaveLength(0);
    });

    it('accepts mixed-case + underscore + digits (case handling happens in the service, not here)', async () => {
      expect(await errorsFor({ username: 'Mazen_123' })).toHaveLength(0);
    });
  });

  describe('password', () => {
    it.each(['1234567', ''])('rejects too-short password %p', async (value) => {
      expect(await errorsFor({ password: value })).not.toHaveLength(0);
    });

    it('accepts the 8-char lower boundary', async () => {
      expect(await errorsFor({ password: '12345678' })).toHaveLength(0);
    });

    it('accepts the 72-char upper boundary (bcrypt input limit)', async () => {
      expect(await errorsFor({ password: 'a'.repeat(72) })).toHaveLength(0);
    });

    it('rejects 73 characters, one past the bcrypt boundary', async () => {
      expect(await errorsFor({ password: 'a'.repeat(73) })).not.toHaveLength(0);
    });
  });

  describe('displayName', () => {
    it('rejects an empty display name', async () => {
      expect(await errorsFor({ displayName: '' })).not.toHaveLength(0);
    });

    it('rejects a display name over 50 characters', async () => {
      expect(await errorsFor({ displayName: 'a'.repeat(51) })).not.toHaveLength(
        0,
      );
    });

    it('accepts the 1 and 50 character boundaries', async () => {
      expect(await errorsFor({ displayName: 'a' })).toHaveLength(0);
      expect(await errorsFor({ displayName: 'a'.repeat(50) })).toHaveLength(0);
    });

    it('does not attempt to sanitize HTML/script content — that is an output-encoding concern for the frontend, not input validation here', async () => {
      // Intentional: displayName is meant to be free-form text (plan.md). This
      // test documents that assumption rather than asserting a "bug".
      expect(
        await errorsFor({ displayName: '<script>alert(1)</script>' }),
      ).toHaveLength(0);
    });
  });

  describe('timezone', () => {
    it('rejects a non-IANA string', async () => {
      expect(await errorsFor({ timezone: 'Not/AZone' })).not.toHaveLength(0);
    });

    it('accepts a lowercase variant of a real IANA zone — normalized to canonical casing rather than rejected (see is-iana-timezone.validator.spec.ts)', async () => {
      expect(await errorsFor({ timezone: 'africa/cairo' })).toHaveLength(0);
    });

    it('rejects a raw UTC offset instead of an IANA name', async () => {
      expect(await errorsFor({ timezone: '+02:00' })).not.toHaveLength(0);
    });

    it('accepts a real IANA zone', async () => {
      expect(await errorsFor({ timezone: 'America/New_York' })).toHaveLength(0);
    });

    it('accepts "UTC" — fixed (see is-iana-timezone.validator.spec.ts for the root-cause explanation)', async () => {
      expect(await errorsFor({ timezone: 'UTC' })).toHaveLength(0);
    });
  });
});
