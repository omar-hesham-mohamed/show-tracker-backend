import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export class SearchShowsDto {
  @IsString()
  @MinLength(1)
  query!: string;

  @IsOptional()
  @IsIn(['movie', 'tv', 'all'])
  type: 'movie' | 'tv' | 'all' = 'all';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;
}
