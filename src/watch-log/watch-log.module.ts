import { Module } from '@nestjs/common';
import { TmdbModule } from '../tmdb/tmdb.module';
import { WatchLogController } from './watch-log.controller';
import { WatchLogService } from './watch-log.service';

@Module({
  imports: [TmdbModule],
  controllers: [WatchLogController],
  providers: [WatchLogService],
})
export class WatchLogModule {}
