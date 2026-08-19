import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListWatchLogDto } from './list-watch-log.dto';

async function errorsFor(payload: Record<string, unknown>) {
  const dto = plainToInstance(ListWatchLogDto, payload);
  return validate(dto);
}

describe('ListWatchLogDto validation', () => {
  it('accepts an empty payload and applies the documented defaults', async () => {
    const dto = plainToInstance(ListWatchLogDto, {});
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.limit).toBe(20);
    expect(dto.sort).toBe('watchedAt_desc');
  });

  describe('status', () => {
    it('is optional', async () => {
      expect(await errorsFor({})).toHaveLength(0);
    });

    it('rejects an unknown status', async () => {
      expect(await errorsFor({ status: 'ARCHIVED' })).not.toHaveLength(0);
    });

    it('accepts a valid status', async () => {
      expect(await errorsFor({ status: 'WATCHED' })).toHaveLength(0);
    });
  });

  describe('limit', () => {
    it('coerces a numeric query-string value', async () => {
      const dto = plainToInstance(ListWatchLogDto, { limit: '10' });
      expect(await validate(dto)).toHaveLength(0);
      expect(dto.limit).toBe(10);
    });

    it('rejects below the 1 floor and above the 50 ceiling', async () => {
      expect(await errorsFor({ limit: 0 })).not.toHaveLength(0);
      expect(await errorsFor({ limit: 51 })).not.toHaveLength(0);
    });

    it('accepts the 1 and 50 boundaries', async () => {
      expect(await errorsFor({ limit: 1 })).toHaveLength(0);
      expect(await errorsFor({ limit: 50 })).toHaveLength(0);
    });
  });

  describe('sort', () => {
    it('rejects a value outside the two documented sort keys', async () => {
      expect(await errorsFor({ sort: 'rating_desc' })).not.toHaveLength(0);
    });

    it('accepts both documented sort keys', async () => {
      expect(await errorsFor({ sort: 'watchedAt_desc' })).toHaveLength(0);
      expect(await errorsFor({ sort: 'watchedAt_asc' })).toHaveLength(0);
    });
  });

  describe('cursor', () => {
    it('is optional and accepts an arbitrary opaque string', async () => {
      expect(await errorsFor({ cursor: 'some-opaque-cursor' })).toHaveLength(0);
    });
  });
});
