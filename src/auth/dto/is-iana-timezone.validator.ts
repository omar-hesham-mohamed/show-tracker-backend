import { Transform } from 'class-transformer';
import { registerDecorator, ValidationOptions } from 'class-validator';

/**
 * Intl.supportedValuesOf('timeZone') deliberately excludes aliases like "UTC"
 * and the whole "Etc/*" namespace (ECMA-402's canonical-names-only list) even
 * though Intl.DateTimeFormat itself correctly resolves them. Asking the
 * resolver directly — rather than checking membership in that narrower list —
 * validates against everything the runtime actually considers a real zone.
 */
function resolveCanonicalTimezone(value: string): string | null {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: value,
    }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/** Validates against the runtime's IANA timezone resolver (e.g. "Africa/Cairo", "UTC"). */
export function IsIanaTimezone(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isIanaTimezone',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return (
            typeof value === 'string' &&
            resolveCanonicalTimezone(value) !== null
          );
        },
        defaultMessage(): string {
          return 'timezone must be a valid IANA timezone string (e.g. "Africa/Cairo")';
        },
      },
    });
  };
}

/**
 * Normalizes a timezone string to its canonical form before validation/storage
 * (e.g. "africa/cairo" -> "Africa/Cairo", "Etc/UTC" -> "UTC") so casing/alias
 * differences that don't affect the actual zone are never rejected, while the
 * DB still only ever stores one consistent, canonical spelling per zone.
 * Input that doesn't resolve to any real zone is passed through unchanged,
 * so @IsIanaTimezone can still reject it with its normal error message.
 */
export function NormalizeIanaTimezone() {
  return Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    return resolveCanonicalTimezone(value) ?? value;
  });
}
