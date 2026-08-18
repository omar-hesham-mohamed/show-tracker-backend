import {
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { MediaType } from '@prisma/client';
import { TmdbService } from './tmdb.service';
import { SearchShowsDto } from './dto/search-shows.dto';

@Controller('shows')
export class ShowsController {
  constructor(private readonly tmdbService: TmdbService) {}

  @Get('search')
  search(@Query() dto: SearchShowsDto) {
    return this.tmdbService.search(dto.query, dto.type, dto.page);
  }

  @Get(':mediaType/:tmdbId')
  getShowDetail(
    @Param('mediaType', new ParseEnumPipe(MediaType)) mediaType: MediaType,
    @Param('tmdbId', ParseIntPipe) tmdbId: number,
  ) {
    return this.tmdbService.getShowDetail(mediaType, tmdbId);
  }

  @Get(':mediaType/:tmdbId/watch-providers')
  getWatchProviders(
    @Param('mediaType', new ParseEnumPipe(MediaType)) mediaType: MediaType,
    @Param('tmdbId', ParseIntPipe) tmdbId: number,
    @Query('region') region?: string,
  ) {
    return this.tmdbService.getWatchProviders(mediaType, tmdbId, region);
  }

  @Get(':mediaType/:tmdbId/recommendations')
  getRecommendations(
    @Param('mediaType', new ParseEnumPipe(MediaType)) mediaType: MediaType,
    @Param('tmdbId', ParseIntPipe) tmdbId: number,
  ) {
    return this.tmdbService.getRecommendations(mediaType, tmdbId);
  }

  @Get('tv/:tmdbId/seasons/:seasonNumber')
  getSeasonDetail(
    @Param('tmdbId', ParseIntPipe) tmdbId: number,
    @Param('seasonNumber', ParseIntPipe) seasonNumber: number,
  ) {
    return this.tmdbService.getSeasonDetail(tmdbId, seasonNumber);
  }
}
