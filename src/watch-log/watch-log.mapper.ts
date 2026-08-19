import { Show, WatchLogEntry, WatchStatus } from '@prisma/client';

export interface ShowSummaryDto {
  id: string;
  tmdbId: number;
  title: string;
  posterPath: string | null;
}

export interface WatchLogEntryDto {
  id: string;
  userId: string;
  show: ShowSummaryDto;
  episodeId: string | null;
  status: WatchStatus;
  rating: number | null;
  watchedAt: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export type WatchLogEntryWithShow = WatchLogEntry & { show: Show };

function toDateOnlyString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function toWatchLogEntryDto(
  entry: WatchLogEntryWithShow,
): WatchLogEntryDto {
  return {
    id: entry.id,
    userId: entry.userId,
    show: {
      id: entry.show.id,
      tmdbId: entry.show.tmdbId,
      title: entry.show.title,
      posterPath: entry.show.posterPath,
    },
    episodeId: entry.episodeId,
    status: entry.status,
    rating: entry.rating === null ? null : Number(entry.rating),
    watchedAt: toDateOnlyString(entry.watchedAt),
    note: entry.note,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
}
