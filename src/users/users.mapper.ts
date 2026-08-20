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

export interface PublicUserProfileDto {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string;
  isPrivate: boolean;
  currentStreakCount: number;
  longestStreakCount: number;
  followerCount: number;
  followingCount: number;
  isFollowedByMe: boolean;
  followsMe: boolean;
}

export interface PrivateProfileStubDto {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  isPrivate: boolean;
  isFollowedByMe: boolean;
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

/** Public/followed shape (endpoints.md) — deliberately omits email/timezone/lastStreakDate/createdAt. */
export function toPublicUserProfileDto(
  user: User,
  followerCount: number,
  followingCount: number,
  isFollowedByMe: boolean,
  followsMe: boolean,
  now: Date = new Date(),
): PublicUserProfileDto {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    isPrivate: user.isPrivate,
    currentStreakCount: getDisplayedCurrentStreak(
      user.currentStreakCount,
      user.lastStreakDate,
      now,
    ),
    longestStreakCount: user.longestStreakCount,
    followerCount,
    followingCount,
    isFollowedByMe,
    followsMe,
  };
}

/** Private, not-followed shape (endpoints.md) — minimal stub, no streak/counts. */
export function toPrivateProfileStubDto(
  user: User,
  isFollowedByMe: boolean,
): PrivateProfileStubDto {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    isPrivate: user.isPrivate,
    isFollowedByMe,
  };
}
