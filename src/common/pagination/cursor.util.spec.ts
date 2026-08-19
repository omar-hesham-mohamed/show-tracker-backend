import { BadRequestException } from '@nestjs/common';
import { decodeCursor, encodeCursor } from './cursor.util';

describe('cursor.util', () => {
  it('round-trips fields through encode/decode', () => {
    const fields = { watchedAt: '2026-08-07T00:00:00.000Z', id: 'abc-123' };
    expect(decodeCursor(encodeCursor(fields))).toEqual(fields);
  });

  it('throws BadRequestException on garbage input', () => {
    expect(() => decodeCursor('not-base64-json')).toThrow(BadRequestException);
  });

  it('throws on a decodable but non-object payload', () => {
    const cursor = Buffer.from(JSON.stringify(['a', 'b']), 'utf8').toString(
      'base64url',
    );
    expect(() => decodeCursor(cursor)).toThrow(BadRequestException);
  });

  it('throws when a field value is not a string', () => {
    const cursor = Buffer.from(JSON.stringify({ id: 1 }), 'utf8').toString(
      'base64url',
    );
    expect(() => decodeCursor(cursor)).toThrow(BadRequestException);
  });
});
