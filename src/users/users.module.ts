import { Module } from '@nestjs/common';
import { FollowModule } from '../follow/follow.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [FollowModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
