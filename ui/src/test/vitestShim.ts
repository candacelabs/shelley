// The part of vitest's describe/it/expect that the terminal tests use, so
// their cases read as usual under this package's plain runner. Call report()
// last.
import { isDeepStrictEqual } from "node:util";

let passed = 0;
let failed = 0;
let suite = "";

export function describe(name: string, fn: () => void) {
  suite = name;
  fn();
}

export function it(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (err) {
    failed++;
    console.error(`\u2717 ${suite} ${name}: ${(err as Error).message}`);
  }
}

export function expect(actual: unknown) {
  const check = (ok: boolean, want: string) => {
    if (!ok) throw new Error(`got ${JSON.stringify(actual)}, want ${want}`);
  };
  return {
    toEqual: (want: unknown) => check(isDeepStrictEqual(actual, want), JSON.stringify(want)),
    toBe: (want: unknown) => check(Object.is(actual, want), JSON.stringify(want)),
    toBeNull: () => check(actual === null, "null"),
    not: {
      toContain: (item: unknown) =>
        check(
          !(actual as { includes(x: unknown): boolean }).includes(item),
          `no ${JSON.stringify(item)}`,
        ),
    },
  };
}

export function report(name: string) {
  if (failed > 0) {
    console.error(`\n${failed} test(s) failed, ${passed} passed`);
    process.exit(1);
  }
  console.log(`\u2713 ${name}: ${passed} tests passed`);
}
