export class OperationTimeoutError extends Error {
  constructor(
    public readonly label:
      string,

    public readonly timeoutMs:
      number,
  ) {
    super(
      `${label} exceeded the ${timeoutMs / 1000}s response timeout.`,
    );

    this.name =
      'OperationTimeoutError';
  }
}

interface TimeoutOptions {
  timeoutMs?: number;
  label?: string;
}

export async function withVisibleTimeout<T>(
  operation:
    () => Promise<T>,

  options:
    TimeoutOptions = {},
): Promise<T> {
  const {
    timeoutMs =
      30_000,

    label =
      'LLM request',
  } = options;

  const startedAt =
    Date.now();

  process.stdout.write(
    `[timer] ${label}: 0s / ${timeoutMs / 1000}s`,
  );

  const interval =
    setInterval(
      () => {
        const elapsed =
          Math.min(
            Math.floor(
              (
                Date.now() -
                startedAt
              ) /
                1000,
            ),

            timeoutMs /
              1000,
          );

        process.stdout.write(
          `\r[timer] ${label}: ${elapsed}s / ${timeoutMs / 1000}s`,
        );
      },

      1000,
    );

  let timeoutId:
    ReturnType<
      typeof setTimeout
    >;

  const timeoutPromise =
    new Promise<never>(
      (
        _,
        reject,
      ) => {
        timeoutId =
          setTimeout(
            () => {
              reject(
                new OperationTimeoutError(
                  label,
                  timeoutMs,
                ),
              );
            },

            timeoutMs,
          );
      },
    );

  try {
    const result =
      await Promise.race([
        operation(),
        timeoutPromise,
      ]);

    const elapsedSeconds =
      (
        (
          Date.now() -
          startedAt
        ) /
        1000
      ).toFixed(2);

    process.stdout.write(
      `\r[timer] ${label}: ${elapsedSeconds}s - completed\n`,
    );

    return result;
  } catch (error) {
    const elapsedSeconds =
      Math.min(
        Math.floor(
          (
            Date.now() -
            startedAt
          ) /
            1000,
        ),

        timeoutMs /
          1000,
      );

    process.stdout.write(
      `\r[timer] ${label}: ${elapsedSeconds}s - stopped\n`,
    );

    throw error;
  } finally {
    clearInterval(
      interval,
    );

    clearTimeout(
      timeoutId!,
    );
  }
}
