import type { HtmlNormalizer } from "./Sanitizer";

export type SyncRequestToken = symbol;

interface SyncRequest {
  readonly token: SyncRequestToken;
  readonly ordinal: number;
  readonly generation: number;
  readonly value: string;
}

interface RetainedFailure {
  readonly error: unknown;
  readonly ordinal: number;
  readonly generation: number;
}

export interface SyncEngineOptions {
  readonly debounceMs: number;
  readonly normalizer: HtmlNormalizer;
  readonly writeValue: (value: string) => Promise<void>;
  readonly onWriteSuccess?: (value: string, request: SyncRequestToken) => void;
  readonly onError?: (error: unknown, request: SyncRequestToken) => void;
  readonly onAlreadySatisfied?: (request: SyncRequestToken) => void;
}

export class SyncEngine {
  private readonly debounceMs: number;
  private readonly normalizer: HtmlNormalizer;
  private readonly writeValue: (value: string) => Promise<void>;
  private readonly onWriteSuccess?: (value: string, request: SyncRequestToken) => void;
  private readonly onError?: (error: unknown, request: SyncRequestToken) => void;
  private readonly onAlreadySatisfied?: (request: SyncRequestToken) => void;

  private disposed = false;
  private timer: number | null = null;
  private queuedRequest: SyncRequest | null = null;
  private lastSuccessfulValue: string | null = null;
  private inFlight: SyncRequest | null = null;
  private tail: Promise<void> = Promise.resolve();
  private activeOperation: Promise<void> = Promise.resolve();
  private generation = 0;
  private scheduleOrdinal = 0;
  private latestScheduleOrdinal = 0;
  private latestCommittedOrdinal = 0;
  private retainedFailure: RetainedFailure | null = null;

  constructor(options: SyncEngineOptions) {
    this.debounceMs = options.debounceMs;
    this.normalizer = options.normalizer;
    this.writeValue = options.writeValue;
    this.onWriteSuccess = options.onWriteSuccess;
    this.onError = options.onError;
    this.onAlreadySatisfied = options.onAlreadySatisfied;
  }

  schedule(nextValue: string, request: SyncRequestToken = Symbol()): void {
    if (this.disposed) {
      return;
    }

    const generation = this.generation;
    const ordinal = ++this.scheduleOrdinal;
    this.latestScheduleOrdinal = ordinal;
    const value = this.normalizer.normalizeHtml(nextValue);
    if (
      this.disposed ||
      generation !== this.generation ||
      ordinal !== this.latestScheduleOrdinal
    ) {
      return;
    }
    this.latestCommittedOrdinal = ordinal;
    this.clearRetainedFailureThrough(generation, ordinal);
    this.queuedRequest = { token: request, ordinal, generation, value };

    if (this.timer !== null) {
      window.clearTimeout(this.timer);
    }

    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.drainQueued().catch(() => undefined);
    }, this.debounceMs);
  }

  async flush(): Promise<void> {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }

    await this.drainQueued();
  }

  alignToHost(value: string): void {
    if (this.disposed) {
      return;
    }

    this.generation += 1;
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    this.queuedRequest = null;
    this.inFlight = null;
    this.lastSuccessfulValue = this.normalizer.normalizeHtml(value);
    this.activeOperation = Promise.resolve();
    this.retainedFailure = null;
  }

  isEcho(value: string): boolean {
    const normalizedValue = this.normalizer.normalizeHtml(value);
    return (
      (this.lastSuccessfulValue !== null && normalizedValue === this.lastSuccessfulValue) ||
      (this.inFlight?.generation === this.generation && this.inFlight.value === normalizedValue)
    );
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.generation += 1;
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    this.queuedRequest = null;
    this.inFlight = null;
    this.activeOperation = Promise.resolve();
    this.retainedFailure = null;
  }

  private enqueue(request: SyncRequest): Promise<void> {
    const operationGeneration = request.generation;
    const operation = this.tail.then(async () => {
      if (this.disposed || operationGeneration !== this.generation) {
        return;
      }
      if (
        this.lastSuccessfulValue !== null &&
        request.value === this.lastSuccessfulValue
      ) {
        this.clearRetainedFailureThrough(request.generation, request.ordinal);
        this.notifyObserver(this.onAlreadySatisfied, request.token);
        return;
      }

      this.inFlight = request;
      try {
        await this.writeValue(request.value);
        if (operationGeneration === this.generation && !this.disposed) {
          this.lastSuccessfulValue = request.value;
          this.clearRetainedFailureThrough(request.generation, request.ordinal);
          this.notifyObserver(this.onWriteSuccess, request.value, request.token);
        }
      } catch (error) {
        this.clearInFlight(request);
        if (operationGeneration === this.generation && !this.disposed) {
          if (request.ordinal === this.latestCommittedOrdinal) {
            this.retainedFailure = {
              error,
              ordinal: request.ordinal,
              generation: request.generation
            };
          }
          this.notifyObserver(this.onError, error, request.token);
        }
        throw error;
      } finally {
        this.clearInFlight(request);
      }
    });

    const predecessor = this.activeOperation;
    this.tail = operation.catch(() => undefined);
    const activeOperation = this.awaitSnapshot([predecessor, operation]);
    this.activeOperation = activeOperation;

    const clearActiveOperation = () => {
      if (this.activeOperation === activeOperation) {
        this.activeOperation = Promise.resolve();
      }
    };
    void activeOperation.then(clearActiveOperation, clearActiveOperation);

    return activeOperation;
  }

  private drainQueued(): Promise<void> {
    const request = this.queuedRequest;
    this.queuedRequest = null;
    if (request !== null) {
      return this.enqueue(request);
    }

    const retainedFailure = this.retainedFailure;
    if (retainedFailure?.generation === this.generation) {
      return Promise.reject(retainedFailure.error);
    }

    return this.activeOperation;
  }

  private async awaitSnapshot(operations: readonly Promise<void>[]): Promise<void> {
    let failed = false;
    let firstError: unknown;

    await Promise.all(
      operations.map(operation =>
        operation.catch(error => {
          if (!failed) {
            failed = true;
            firstError = error;
          }
        })
      )
    );

    if (failed) {
      throw firstError;
    }
  }

  private clearInFlight(request: SyncRequest): void {
    if (this.inFlight === request) {
      this.inFlight = null;
    }
  }

  private clearRetainedFailureThrough(generation: number, ordinal: number): void {
    const retainedFailure = this.retainedFailure;
    if (
      retainedFailure?.generation === generation &&
      retainedFailure.ordinal <= ordinal
    ) {
      this.retainedFailure = null;
    }
  }

  private notifyObserver<TArgs extends readonly unknown[]>(
    observer: ((...values: TArgs) => void) | undefined,
    ...values: TArgs
  ): void {
    if (!observer) {
      return;
    }

    try {
      void Promise.resolve(observer(...values)).catch(() => undefined);
    } catch {
      return;
    }
  }
}
