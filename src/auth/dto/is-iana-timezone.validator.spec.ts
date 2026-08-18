import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  IsIanaTimezone,
  NormalizeIanaTimezone,
} from './is-iana-timezone.validator';

class TestDto {
  @NormalizeIanaTimezone()
  @IsIanaTimezone()
  timezone!: unknown;
}

async function check(
  value: unknown,
): Promise<{ valid: boolean; normalized: unknown }> {
  const dto = plainToInstance(TestDto, { timezone: value });
  const errors = await validate(dto);
  return { valid: errors.length === 0, normalized: dto.timezone };
}

async function isValid(value: unknown): Promise<boolean> {
  return (await check(value)).valid;
}

describe('IsIanaTimezone + NormalizeIanaTimezone', () => {
  it('accepts real, already-canonical IANA zones unchanged', async () => {
    expect(await isValid('Africa/Cairo')).toBe(true);
    expect(await isValid('America/New_York')).toBe(true);
  });

  it('accepts UTC — fixed: Intl.supportedValuesOf("timeZone") excludes it, but Intl.DateTimeFormat correctly resolves it', async () => {
    const { valid, normalized } = await check('UTC');
    expect(valid).toBe(true);
    expect(normalized).toBe('UTC');
  });

  it('accepts real aliases outside the "canonical names" list and normalizes them to their canonical form', async () => {
    expect(await check('Etc/UTC')).toEqual({ valid: true, normalized: 'UTC' });
    expect(await check('GMT')).toEqual({ valid: true, normalized: 'UTC' });
    expect(await check('US/Eastern')).toEqual({
      valid: true,
      normalized: 'America/New_York',
    });
  });

  it('normalizes casing rather than rejecting it — a real zone sent in the wrong case is still accepted, and stored canonically', async () => {
    expect(await check('africa/cairo')).toEqual({
      valid: true,
      normalized: 'Africa/Cairo',
    });
    expect(await check('AFRICA/CAIRO')).toEqual({
      valid: true,
      normalized: 'Africa/Cairo',
    });
  });

  it('rejects a made-up zone name', async () => {
    expect(await isValid('Not/AZone')).toBe(false);
  });

  it('rejects an empty string', async () => {
    expect(await isValid('')).toBe(false);
  });

  it('rejects raw UTC-offset/Zulu notation — these are not IANA identifiers, even with the normalization step in place', async () => {
    expect(await isValid('GMT+2')).toBe(false);
    expect(await isValid('+02:00')).toBe(false);
    expect(await isValid('Z')).toBe(false);
  });

  it('rejects non-string values outright', async () => {
    expect(await isValid(12345)).toBe(false);
    expect(await isValid(null)).toBe(false);
    expect(await isValid(undefined)).toBe(false);
    expect(await isValid({ zone: 'Africa/Cairo' })).toBe(false);
  });

  it('rejects a valid zone name with leading/trailing whitespace — confirmed Intl.DateTimeFormat does not trim, so this is not silently accepted', async () => {
    expect(await isValid('Africa/Cairo ')).toBe(false);
    expect(await isValid(' Africa/Cairo')).toBe(false);
  });

  it('leaves unresolvable input untouched (does not mangle it) so the validator error message reflects what was actually sent', async () => {
    const { normalized } = await check('Not/AZone');
    expect(normalized).toBe('Not/AZone');
  });
});
