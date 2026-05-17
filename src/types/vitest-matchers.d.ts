interface JestDomMatchers<R> {
  toBeInTheDocument(): R;
  toHaveAttribute(attribute: string, value?: unknown): R;
}

declare module 'vitest' {
  interface Assertion<T = unknown> extends JestDomMatchers<void> {}
  interface AsymmetricMatchersContaining extends JestDomMatchers<void> {}
}

declare module '@vitest/expect' {
  interface Assertion<T = unknown> extends JestDomMatchers<void> {}
  interface AsymmetricMatchersContaining extends JestDomMatchers<void> {}
}

export {};
