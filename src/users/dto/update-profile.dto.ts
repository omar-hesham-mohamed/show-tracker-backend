import {
  IsBoolean,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  IsIanaTimezone,
  NormalizeIanaTimezone,
} from '../../auth/dto/is-iana-timezone.validator';

/**
 * @IsOptional() treats null the same as undefined and would let an explicit
 * {"displayName": null} bypass validation and crash the DB write (bug found
 * via testing on update-watch-log.dto.ts — see plan.md). @ValidateIf here
 * only skips validation when the field is truly absent; an explicit null
 * still runs through — and fails — the field's own validator.
 */
const isPresent = (_: unknown, value: unknown) => value !== undefined;

export class UpdateProfileDto {
  @ValidateIf(isPresent)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  displayName?: string;

  @ValidateIf(isPresent)
  @IsString()
  @MaxLength(500)
  bio?: string;

  @ValidateIf(isPresent)
  @NormalizeIanaTimezone()
  @IsIanaTimezone()
  timezone?: string;

  @ValidateIf(isPresent)
  @IsBoolean()
  isPrivate?: boolean;
}
