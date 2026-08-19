import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateWatchLogDto } from './update-watch-log.dto';

async function errorsFor(payload: Record<string, unknown>) {
  const dto = plainToInstance(UpdateWatchLogDto, payload);
  return validate(dto);
}

describe('UpdateWatchLogDto validation', () => {
  it('accepts an empty payload — every field is optional (partial update)', async () => {
    expect(await errorsFor({})).toHaveLength(0);
  });

  it('accepts a single-field patch for each field independently', async () => {
    expect(await errorsFor({ status: 'WATCHING' })).toHaveLength(0);
    expect(await errorsFor({ rating: 3.5 })).toHaveLength(0);
    expect(await errorsFor({ watchedAt: '2026-08-07' })).toHaveLength(0);
    expect(await errorsFor({ note: 'updated note' })).toHaveLength(0);
  });

  it('rejects an unknown status when provided', async () => {
    expect(await errorsFor({ status: 'DROPPED' })).not.toHaveLength(0);
  });

  it('rejects an off-grid rating when provided (delegates to IsHalfStarRating)', async () => {
    expect(await errorsFor({ rating: 2.2 })).not.toHaveLength(0);
  });

  it('rejects a full timestamp for watchedAt when provided (strict date-only)', async () => {
    expect(
      await errorsFor({ watchedAt: '2026-08-07T00:00:00.000Z' }),
    ).not.toHaveLength(0);
  });

  it('rejects a note over 2000 characters when provided', async () => {
    expect(await errorsFor({ note: 'a'.repeat(2001) })).not.toHaveLength(0);
  });

  describe('explicit null (bug found via testing — see plan.md)', () => {
    // @IsOptional() treats null the same as undefined and would have let
    // these through to crash a NOT NULL Prisma column write with a raw 500.
    // @ValidateIf(isPresent) only exempts true omission (undefined).
    it('rejects an explicit null for status', async () => {
      expect(await errorsFor({ status: null })).not.toHaveLength(0);
    });

    it('rejects an explicit null for watchedAt', async () => {
      expect(await errorsFor({ watchedAt: null })).not.toHaveLength(0);
    });

    it('rejects an explicit null for note', async () => {
      expect(await errorsFor({ note: null })).not.toHaveLength(0);
    });

    it('rejects an explicit null for rating', async () => {
      expect(await errorsFor({ rating: null })).not.toHaveLength(0);
    });

    it('still accepts a fully omitted (undefined) payload', async () => {
      expect(await errorsFor({})).toHaveLength(0);
    });
  });
});
