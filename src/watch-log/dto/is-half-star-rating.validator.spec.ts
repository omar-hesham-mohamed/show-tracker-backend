import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { IsHalfStarRating } from './is-half-star-rating.validator';

class TestDto {
  @IsHalfStarRating()
  rating!: unknown;
}

async function isValid(value: unknown): Promise<boolean> {
  const dto = plainToInstance(TestDto, { rating: value });
  const errors = await validate(dto);
  return errors.length === 0;
}

describe('IsHalfStarRating', () => {
  it('accepts every value on the 0.5-5.0 half-star grid', async () => {
    for (let doubled = 1; doubled <= 10; doubled++) {
      expect(await isValid(doubled / 2)).toBe(true);
    }
  });

  it('rejects off-grid values', async () => {
    expect(await isValid(4.3)).toBe(false);
    expect(await isValid(0.1)).toBe(false);
    expect(await isValid(3.75)).toBe(false);
  });

  it('rejects values outside the 0.5-5.0 range', async () => {
    expect(await isValid(0)).toBe(false);
    expect(await isValid(5.5)).toBe(false);
    expect(await isValid(-0.5)).toBe(false);
  });

  it('rejects non-numeric values', async () => {
    expect(await isValid('4.5')).toBe(false);
    expect(await isValid(null)).toBe(false);
    expect(await isValid(undefined)).toBe(false);
    expect(await isValid(NaN)).toBe(false);
  });
});
