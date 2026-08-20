import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { OptionalAuth } from '../common/decorators/optional-auth.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { WatchLogService } from './watch-log.service';
import { CreateWatchLogDto } from './dto/create-watch-log.dto';
import { UpdateWatchLogDto } from './dto/update-watch-log.dto';
import { ListWatchLogDto } from './dto/list-watch-log.dto';

@Controller('watch-log')
export class WatchLogController {
  constructor(private readonly watchLogService: WatchLogService) {}

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateWatchLogDto,
  ) {
    return this.watchLogService.create(user.id, dto);
  }

  @Get('me')
  findMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() dto: ListWatchLogDto,
  ) {
    return this.watchLogService.findMine(user.id, dto);
  }

  @OptionalAuth()
  @Get('user/:username')
  findForUser(
    @CurrentUser() user: AuthenticatedUser | null,
    @Param('username') username: string,
    @Query() dto: ListWatchLogDto,
  ) {
    return this.watchLogService.findForUser(username, user?.id ?? null, dto);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.watchLogService.findOne(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateWatchLogDto,
  ) {
    return this.watchLogService.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.watchLogService.remove(user.id, id);
  }
}
