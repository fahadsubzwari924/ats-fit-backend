import { Transform, TransformFnParams } from 'class-transformer';

export function TrimString() {
  return function (target: any, key: string) {
    Transform(({ value }: TransformFnParams) => {
      if (typeof value === 'string') {
        return value.trim();
      }
      return typeof value === 'string' ? value : String(value);
    })(target, key);
  };
}
