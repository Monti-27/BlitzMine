declare module "bun:test" {
  export const describe: (
    name: string,
    fn: () => void | Promise<void>,
  ) => void;
  export const it: (
    name: string,
    fn: () => void | Promise<void>,
  ) => void;
  export const expect: {
    (value: unknown): {
      toBe: (expected: unknown) => void;
    };
  };
}
