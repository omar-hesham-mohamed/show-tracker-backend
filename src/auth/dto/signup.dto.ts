import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { IsIanaTimezone } from './is-iana-timezone.validator';

export class SignupDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Matches(/^[a-z0-9_]{3,20}$/i, {
    message:
      'username must be 3-20 characters, letters/numbers/underscore only',
  })
  username!: string;

  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  @MaxLength(72, { message: 'password must be at most 72 characters' }) // bcrypt's input limit
  password!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(50)
  displayName!: string;

  @IsIanaTimezone()
  timezone!: string;
}
