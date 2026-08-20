import { Module } from '@nestjs/common';
import { FollowModule } from '../follow/follow.module';
import { StreakController } from './streak.controller';
import { StreakService } from './streak.service';

@Module({
  imports: [FollowModule],
  controllers: [StreakController],
  providers: [StreakService],
  exports: [StreakService],
})
export class StreakModule {}
