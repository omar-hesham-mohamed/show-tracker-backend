import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LoginDto } from './login.dto';
import { RefreshDto } from './refresh.dto';
import { LogoutDto } from './logout.dto';

describe('LoginDto validation', () => {
  it('accepts a valid payload', async () => {
    const dto = plainToInstance(LoginDto, {
      emailOrUsername: 'mazen',
      password: 'x',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it.each([
    ['missing emailOrUsername', { password: 'x' }],
    ['empty emailOrUsername', { emailOrUsername: '', password: 'x' }],
    ['missing password', { emailOrUsername: 'mazen' }],
    ['empty password', { emailOrUsername: 'mazen', password: '' }],
    [
      'non-string emailOrUsername (object-injection attempt)',
      { emailOrUsername: { $ne: null }, password: 'x' },
    ],
    ['non-string password', { emailOrUsername: 'mazen', password: 12345 }],
  ])('rejects %s', async (_label, payload) => {
    const dto = plainToInstance(LoginDto, payload);
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('RefreshDto validation', () => {
  it('accepts a valid payload', async () => {
    const dto = plainToInstance(RefreshDto, { refreshToken: 'abc123' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects a missing/empty refreshToken', async () => {
    expect(await validate(plainToInstance(RefreshDto, {}))).not.toHaveLength(0);
    expect(
      await validate(plainToInstance(RefreshDto, { refreshToken: '' })),
    ).not.toHaveLength(0);
  });

  it('rejects a non-string refreshToken (e.g. an array, attempting a NoSQL-style operator injection)', async () => {
    const dto = plainToInstance(RefreshDto, { refreshToken: ['a', 'b'] });
    expect(await validate(dto)).not.toHaveLength(0);
  });
});

describe('LogoutDto validation (extends RefreshDto)', () => {
  it('inherits the same refreshToken validation', async () => {
    expect(
      await validate(plainToInstance(LogoutDto, { refreshToken: 'abc' })),
    ).toHaveLength(0);
    expect(await validate(plainToInstance(LogoutDto, {}))).not.toHaveLength(0);
  });
});
