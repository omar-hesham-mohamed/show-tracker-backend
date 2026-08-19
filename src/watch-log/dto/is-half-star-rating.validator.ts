import { registerDecorator, ValidationOptions } from 'class-validator';

/** Rating scale: 0.5-5.0 in 0.5 increments (confirmed in plan.md). */
export function IsHalfStarRating(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isHalfStarRating',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'number' || !Number.isFinite(value)) {
            return false;
          }
          const doubled = value * 2;
          return Number.isInteger(doubled) && doubled >= 1 && doubled <= 10;
        },
        defaultMessage(): string {
          return 'rating must be between 0.5 and 5.0 in 0.5 increments';
        },
      },
    });
  };
}
