export interface TimedResult<T> {
  result: T;
  durationMs: number;
}

export async function measureDuration<T>(
  operation:
    () => Promise<T>,
): Promise<TimedResult<T>> {
  const startedAt =
    performance.now();

  const result =
    await operation();

  const finishedAt =
    performance.now();

  return {
    result,

    durationMs:
      Math.round(
        finishedAt -
          startedAt,
      ),
  };
}
