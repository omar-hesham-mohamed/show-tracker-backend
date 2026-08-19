import { randomUUID } from 'crypto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateWatchLogDto } from './create-watch-log.dto';

async function errorsFor(
  overrides: Partial<Record<keyof CreateWatchLogDto, unknown>>,
) {
  const base = {
    tmdbId: 1399,
    mediaType: 'tv',
    status: 'WATCHED',
    watchedAt: '2026-08-07',
  };
  const dto = plainToInstance(CreateWatchLogDto, { ...base, ...overrides });
  return validate(dto);
}

describe('CreateWatchLogDto validation', () => {
  it('accepts a minimal valid payload (no episodeId/rating/note)', async () => {
    expect(await errorsFor({})).toHaveLength(0);
  });

  it('accepts a fully populated payload', async () => {
    expect(
      await errorsFor({
        episodeId: randomUUID(),
        rating: 4.5,
        note: 'great episode',
      }),
    ).toHaveLength(0);
  });

  describe('tmdbId', () => {
    it('rejects a missing tmdbId', async () => {
      expect(await errorsFor({ tmdbId: undefined })).not.toHaveLength(0);
    });

    it('rejects a non-positive tmdbId', async () => {
      expect(await errorsFor({ tmdbId: 0 })).not.toHaveLength(0);
      expect(await errorsFor({ tmdbId: -5 })).not.toHaveLength(0);
    });

    it('coerces a numeric string, matching how query/body values arrive over HTTP', async () => {
      expect(await errorsFor({ tmdbId: '1399' })).toHaveLength(0);
    });
  });

  describe('mediaType', () => {
    it('rejects an unknown mediaType', async () => {
      expect(await errorsFor({ mediaType: 'book' })).not.toHaveLength(0);
    });

    it('accepts both movie and tv', async () => {
      expect(await errorsFor({ mediaType: 'movie' })).toHaveLength(0);
      expect(await errorsFor({ mediaType: 'tv' })).toHaveLength(0);
    });
  });

  describe('status', () => {
    it('rejects an unknown status', async () => {
      expect(await errorsFor({ status: 'PLANNING_TO_WATCH' })).not.toHaveLength(
        0,
      );
    });

    it('accepts all three documented statuses', async () => {
      expect(await errorsFor({ status: 'WATCHED' })).toHaveLength(0);
      expect(await errorsFor({ status: 'WATCHING' })).toHaveLength(0);
      expect(await errorsFor({ status: 'WANT_TO_WATCH' })).toHaveLength(0);
    });
  });

  describe('episodeId', () => {
    it('is optional — omitting it is valid', async () => {
      expect(await errorsFor({ episodeId: undefined })).toHaveLength(0);
    });

    it('rejects a non-UUID value', async () => {
      expect(await errorsFor({ episodeId: 'not-a-uuid' })).not.toHaveLength(0);
    });
  });

  describe('rating', () => {
    it('is optional — omitting it is valid', async () => {
      expect(await errorsFor({ rating: undefined })).toHaveLength(0);
    });

    it('rejects an off-grid rating (delegates to IsHalfStarRating)', async () => {
      expect(await errorsFor({ rating: 4.3 })).not.toHaveLength(0);
    });

    it('accepts a valid half-star rating', async () => {
      expect(await errorsFor({ rating: 4.5 })).toHaveLength(0);
    });
  });

  describe('watchedAt', () => {
    it('rejects a missing watchedAt', async () => {
      expect(await errorsFor({ watchedAt: undefined })).not.toHaveLength(0);
    });

    it('rejects a full timestamp — only a date-only string is accepted (IsDateString strict)', async () => {
      expect(
        await errorsFor({ watchedAt: '2026-08-07T00:00:00.000Z' }),
      ).not.toHaveLength(0);
    });

    it('rejects a non-date string', async () => {
      expect(await errorsFor({ watchedAt: 'not-a-date' })).not.toHaveLength(0);
    });

    it('accepts a plain YYYY-MM-DD string', async () => {
      expect(await errorsFor({ watchedAt: '2026-08-07' })).toHaveLength(0);
    });
  });

  describe('note', () => {
    it('is optional — omitting it is valid', async () => {
      expect(await errorsFor({ note: undefined })).toHaveLength(0);
    });

    it('rejects a note over 2000 characters', async () => {
      expect(await errorsFor({ note: 'a'.repeat(2001) })).not.toHaveLength(0);
    });

    it('accepts the 2000-character boundary', async () => {
      expect(await errorsFor({ note: 'a'.repeat(2000) })).toHaveLength(0);
    });
  });
});
