import { Module } from '@nestjs/common';
import { TmdbModule } from '../tmdb/tmdb.module';
import { StreakModule } from '../streak/streak.module';
import { FollowModule } from '../follow/follow.module';
import { WatchLogController } from './watch-log.controller';
import { WatchLogService } from './watch-log.service';

@Module({
  imports: [TmdbModule, StreakModule, FollowModule],
  controllers: [WatchLogController],
  providers: [WatchLogService],
})
export class WatchLogModule {}
