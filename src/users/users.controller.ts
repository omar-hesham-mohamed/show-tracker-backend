import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { OptionalAuth } from '../common/decorators/optional-auth.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  getMe(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.getMe(user.id);
  }

  @Patch('me')
  updateMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.usersService.updateMe(user.id, dto);
  }

  // Must come after 'me' — a literal segment ('me') needs to be registered
  // before the dynamic ':username' catch-all on the same controller, same
  // ordering gotcha already handled in WatchLogController.
  @OptionalAuth()
  @Get(':username')
  getByUsername(
    @CurrentUser() user: AuthenticatedUser | null,
    @Param('username') username: string,
  ) {
    return this.usersService.getPublicProfile(username, user?.id ?? null);
  }
}
