import { User } from '@prisma/client';

export interface FollowListItemDto {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  isFollowedByMe: boolean;
}

export function toFollowListItemDto(
  user: User,
  isFollowedByMe: boolean,
): FollowListItemDto {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    isFollowedByMe,
  };
}
