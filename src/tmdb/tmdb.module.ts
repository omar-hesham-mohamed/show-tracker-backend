import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { TmdbService } from './tmdb.service';
import { ShowsController } from './shows.controller';
import { TMDB_API_BASE_URL } from './tmdb.constants';

@Module({
  imports: [
    HttpModule.registerAsync({
      useFactory: (config: ConfigService) => ({
        baseURL: TMDB_API_BASE_URL,
        timeout: 5000,
        headers: {
          Authorization: `Bearer ${config.getOrThrow<string>('TMDB_ACCESS_TOKEN')}`,
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [ShowsController],
  providers: [TmdbService],
  exports: [TmdbService],
})
export class TmdbModule {}
