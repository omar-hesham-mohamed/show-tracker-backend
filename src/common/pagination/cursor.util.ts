import { BadRequestException } from '@nestjs/common';

/**
 * Opaque cursor codec shared by any keyset-paginated list endpoint
 * (endpoints.md: "cursor-based on list endpoints that can grow unbounded —
 * feed, diary, followers/following"). Only the encode/decode step is shared;
 * each service builds its own keyset WHERE comparison from the decoded
 * fields, since the sort columns differ per resource.
 */
export function encodeCursor(fields: Record<string, string>): string {
  return Buffer.from(JSON.stringify(fields), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    );
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed) ||
      Object.values(parsed).some((value) => typeof value !== 'string')
    ) {
      throw new Error('malformed cursor shape');
    }
    return parsed as Record<string, string>;
  } catch {
    throw new BadRequestException('Invalid cursor');
  }
}
