export function assertIsolatedCoachDatabase(testUrl: string, workingUrl?: string): void {
  const test = new URL(testUrl);
  if (!/_test(?:_|$)/i.test(test.pathname.slice(1))) throw new Error('Refusing integration tests: database must have an explicit _test name.');
  if (workingUrl) {
    const working = new URL(workingUrl);
    const identity = (u: URL) => `${u.hostname.toLowerCase()}:${u.port || '5432'}${u.pathname}`;
    if (identity(test) === identity(working)) throw new Error('Refusing integration tests: working and test databases are the same.');
  }
}
