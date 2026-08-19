import { User } from '@prisma/client';
import { getDisplayedCurrentStreak } from '../streak/streak.util';

export interface UserProfileDto {
  id: string;
  username: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string;
  timezone: string;
  isPrivate: boolean;
  currentStreakCount: number;
  longestStreakCount: number;
  lastStreakDate: string | null;
  followerCount: number;
  followingCount: number;
  createdAt: string;
}

function toDateOnlyString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function toUserProfileDto(
  user: User,
  followerCount: number,
  followingCount: number,
  now: Date = new Date(),
): UserProfileDto {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    timezone: user.timezone,
    isPrivate: user.isPrivate,
    currentStreakCount: getDisplayedCurrentStreak(
      user.currentStreakCount,
      user.lastStreakDate,
      now,
    ),
    longestStreakCount: user.longestStreakCount,
    lastStreakDate: user.lastStreakDate
      ? toDateOnlyString(user.lastStreakDate)
      : null,
    followerCount,
    followingCount,
    createdAt: user.createdAt.toISOString(),
  };
}
