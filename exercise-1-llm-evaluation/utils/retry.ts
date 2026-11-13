import {
  OperationTimeoutError,
} from './timeout.js';

interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  label?: string;
}

function sleep(
  milliseconds: number,
): Promise<void> {
  return new Promise(
    (resolve) => {
      setTimeout(
        resolve,
        milliseconds,
      );
    },
  );
}

function getStatus(
  error: unknown,
): number | null {
  if (
    typeof error !== 'object' ||
    error === null
  ) {
    return null;
  }

  const candidate =
    error as {
      status?: unknown;
      statusCode?: unknown;
      code?: unknown;
      response?: {
        status?: unknown;
      };
    };

  const values = [
    candidate.status,
    candidate.statusCode,
    candidate.code,
    candidate.response?.status,
  ];

  for (
    const value
    of values
  ) {
    if (
      typeof value === 'number'
    ) {
      return value;
    }

    if (
      typeof value === 'string'
    ) {
      const parsed =
        Number(value);

      if (
        Number.isInteger(
          parsed,
        )
      ) {
        return parsed;
      }
    }
  }

  return null;
}

export function getErrorSummary(
  error: unknown,
): string {
  if (
    error instanceof Error
  ) {
    return error.message;
  }

  if (
    typeof error === 'string'
  ) {
    return error;
  }

  try {
    return JSON.stringify(
      error,
    );
  } catch {
    return String(error);
  }
}

function containsZeroQuota(
  error: unknown,
): boolean {
  const summary =
    getErrorSummary(
      error,
    ).toLowerCase();

  return (
    summary.includes(
      'limit: 0',
    ) ||
    summary.includes(
      '"limit":0',
    ) ||
    summary.includes(
      'quota limit 0',
    )
  );
}

export function isRetryableError(
  error: unknown,
): boolean {
  if (
    error instanceof
    OperationTimeoutError
  ) {
    return false;
  }

  if (
    containsZeroQuota(
      error,
    )
  ) {
    return false;
  }

  const status =
    getStatus(
      error,
    );

  if (
    status !== null &&
    [
      429,
      500,
      502,
      503,
      504,
    ].includes(status)
  ) {
    return true;
  }

  const summary =
    getErrorSummary(
      error,
    ).toLowerCase();

  const transientMessages = [
    'rate limit',
    'resource exhausted',
    'temporarily unavailable',
    'service unavailable',
    'overloaded',
    'timeout',
    'timed out',
    'connection reset',
    'network error',
    'fetch failed',
    'econnreset',
    'etimedout',
  ];

  return transientMessages.some(
    (message) =>
      summary.includes(
        message,
      ),
  );
}

export function isInfrastructureError(
  error: unknown,
): boolean {
  if (
    error instanceof
    OperationTimeoutError
  ) {
    return true;
  }

  const status =
    getStatus(
      error,
    );

  if (
    status !== null &&
    [
      401,
      403,
      404,
      408,
      409,
      429,
      500,
      502,
      503,
      504,
    ].includes(status)
  ) {
    return true;
  }

  const summary =
    getErrorSummary(
      error,
    ).toLowerCase();

  const infrastructureMessages = [
    'tool execution failed',
    'rate limit',
    'quota',
    'resource exhausted',
    'service unavailable',
    'temporarily unavailable',
    'overloaded',
    'timeout',
    'timed out',
    'network error',
    'fetch failed',
    'connection reset',
    'econnreset',
    'etimedout',
    'api key',
    'authentication',
    'unauthorized',
    'model',
    'not found',
  ];

  return infrastructureMessages.some(
    (message) =>
      summary.includes(
        message,
      ),
  );
}

export async function withRetry<T>(
  operation:
    () => Promise<T>,

  options:
    RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelayMs = 1500,
    maxDelayMs = 6000,
    label = 'Operation',
  } = options;

  let lastError:
    unknown;

  for (
    let attempt = 1;
    attempt <= maxAttempts;
    attempt += 1
  ) {
    try {
      return await operation();
    } catch (error) {
      lastError =
        error;

      const canRetry =
        attempt <
          maxAttempts &&
        isRetryableError(
          error,
        );

      if (
        !canRetry
      ) {
        throw error;
      }

      const delay =
        Math.min(
          initialDelayMs *
            2 **
              (attempt - 1),

          maxDelayMs,
        );

      console.warn(
        `[retry] ${label} failed on attempt ${attempt}/${maxAttempts}. Retrying in ${delay}ms...`,
      );

      await sleep(
        delay,
      );
    }
  }

  throw lastError;
}

