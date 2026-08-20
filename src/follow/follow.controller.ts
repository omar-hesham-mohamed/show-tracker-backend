import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { OptionalAuth } from '../common/decorators/optional-auth.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { FollowService } from './follow.service';
import { ListFollowDto } from './dto/list-follow.dto';

@Controller('users/:username')
export class FollowController {
  constructor(private readonly followService: FollowService) {}

  @Post('follow')
  @HttpCode(HttpStatus.NO_CONTENT)
  follow(
    @CurrentUser() user: AuthenticatedUser,
    @Param('username') username: string,
  ) {
    return this.followService.follow(user.id, username);
  }

  @Delete('follow')
  @HttpCode(HttpStatus.NO_CONTENT)
  unfollow(
    @CurrentUser() user: AuthenticatedUser,
    @Param('username') username: string,
  ) {
    return this.followService.unfollow(user.id, username);
  }

  @OptionalAuth()
  @Get('followers')
  getFollowers(
    @CurrentUser() user: AuthenticatedUser | null,
    @Param('username') username: string,
    @Query() dto: ListFollowDto,
  ) {
    return this.followService.getFollowers(username, user?.id ?? null, dto);
  }

  @OptionalAuth()
  @Get('following')
  getFollowing(
    @CurrentUser() user: AuthenticatedUser | null,
    @Param('username') username: string,
    @Query() dto: ListFollowDto,
  ) {
    return this.followService.getFollowing(username, user?.id ?? null, dto);
  }
}
