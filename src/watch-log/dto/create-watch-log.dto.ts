import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { MediaType, WatchStatus } from '@prisma/client';
import { IsHalfStarRating } from './is-half-star-rating.validator';

export class CreateWatchLogDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  tmdbId!: number;

  @IsEnum(MediaType)
  mediaType!: MediaType;

  @IsOptional()
  @IsUUID()
  episodeId?: string;

  @IsEnum(WatchStatus)
  status!: WatchStatus;

  @IsOptional()
  @IsHalfStarRating()
  rating?: number;

  /**
   * Client's local date (YYYY-MM-DD) — used for streak-day comparison in
   * Phase 5. `IsDateString({ strict: true })`'s `strict` option only rejects
   * invalid *calendar* dates (e.g. Feb 30) — it does NOT restrict the format
   * to date-only, so a full ISO timestamp would otherwise pass and then
   * corrupt the `${watchedAt}T00:00:00.000Z` construction in the service.
   * The `@Matches` regex is what actually enforces the date-only shape.
   */
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'watchedAt must be a date-only string (YYYY-MM-DD)',
  })
  @IsDateString({ strict: true })
  watchedAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
