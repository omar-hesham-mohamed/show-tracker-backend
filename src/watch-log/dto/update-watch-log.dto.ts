import {
  IsDateString,
  IsEnum,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { WatchStatus } from '@prisma/client';
import { IsHalfStarRating } from './is-half-star-rating.validator';

/**
 * `@IsOptional()` treats `null` the same as `undefined` — it skips the rest
 * of that field's validators entirely, which would let an explicit
 * `{"status": null}` (or watchedAt/note — all NOT NULL Prisma columns) sail
 * through validation and crash the DB write with an unhandled 500 instead
 * of a 400 (bug found via testing — see plan.md). `@ValidateIf` here only
 * skips validation when the field is truly *absent* (`undefined`); an
 * explicit `null` still runs through — and fails — the field's own
 * validator, since none of them accept `null`.
 */
const isPresent = (_: unknown, value: unknown) => value !== undefined;

export class UpdateWatchLogDto {
  @ValidateIf(isPresent)
  @IsEnum(WatchStatus)
  status?: WatchStatus;

  @ValidateIf(isPresent)
  @IsHalfStarRating()
  rating?: number;

  /** See create-watch-log.dto.ts's watchedAt comment — @Matches enforces date-only, @IsDateString({strict:true}) enforces calendar validity. */
  @ValidateIf(isPresent)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'watchedAt must be a date-only string (YYYY-MM-DD)',
  })
  @IsDateString({ strict: true })
  watchedAt?: string;

  @ValidateIf(isPresent)
  @IsString()
  @MaxLength(2000)
  note?: string;
}
