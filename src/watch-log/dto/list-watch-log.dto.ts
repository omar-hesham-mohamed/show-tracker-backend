import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { WatchStatus } from '@prisma/client';

export type WatchLogSort = 'watchedAt_desc' | 'watchedAt_asc';

export class ListWatchLogDto {
  @IsOptional()
  @IsEnum(WatchStatus)
  status?: WatchStatus;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;

  @IsOptional()
  @IsIn(['watchedAt_desc', 'watchedAt_asc'])
  sort: WatchLogSort = 'watchedAt_desc';
}
