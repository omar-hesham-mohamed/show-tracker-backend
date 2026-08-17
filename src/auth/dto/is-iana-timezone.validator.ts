import { registerDecorator, ValidationOptions } from 'class-validator';

let supportedTimezones: Set<string> | null = null;

function getSupportedTimezones(): Set<string> {
  if (!supportedTimezones) {
    supportedTimezones = new Set(Intl.supportedValuesOf('timeZone'));
  }
  return supportedTimezones;
}

/** Validates against the runtime's IANA timezone database (e.g. "Africa/Cairo"). */
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
            typeof value === 'string' && getSupportedTimezones().has(value)
          );
        },
        defaultMessage(): string {
          return 'timezone must be a valid IANA timezone string (e.g. "Africa/Cairo")';
        },
      },
    });
  };
}
