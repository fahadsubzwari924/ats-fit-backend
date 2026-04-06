import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

type DateRangeFields = {
  applied_at_from?: string;
  applied_at_to?: string;
  deadline_from?: string;
  deadline_to?: string;
  follow_up_from?: string;
  follow_up_to?: string;
};

function isOrderedPair(from?: string, to?: string): boolean {
  if (!from || !to) return true;
  return new Date(from).getTime() <= new Date(to).getTime();
}

@ValidatorConstraint({ name: 'jobApplicationQueryDateRanges', async: false })
export class JobApplicationQueryDateRangesConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const o = args.object as DateRangeFields;
    return (
      isOrderedPair(o.applied_at_from, o.applied_at_to) &&
      isOrderedPair(o.deadline_from, o.deadline_to) &&
      isOrderedPair(o.follow_up_from, o.follow_up_to)
    );
  }

  defaultMessage(): string {
    return 'each date range requires "from" to be on or before "to" when both are set';
  }
}
