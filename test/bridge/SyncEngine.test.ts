import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sanitizer, type HtmlNormalizer } from "../../src/bridge/Sanitizer";
import { SyncEngine, type SyncRequestToken } from "../../src/bridge/SyncEngine";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

const emptyNormalizer: HtmlNormalizer = {
  normalizeHtml: () => ""
};

async function settlesBeforeNextTimer(promise: Promise<unknown>): Promise<boolean> {
  const outcome = Promise.race([
    promise.then(
      () => true,
      () => true
    ),
    new Promise<boolean>(resolve => {
      window.setTimeout(() => resolve(false), 1);
    })
  ]);

  await vi.advanceTimersByTimeAsync(1);
  return outcome;
}

describe("SyncEngine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries the same canonical value after its first write rejects", async () => {
    const firstWrite = deferred<void>();
    const secondWrite = deferred<void>();
    const firstWriteEntered = deferred<void>();
    const secondWriteEntered = deferred<void>();
    const writes: string[] = [];
    const engine = new SyncEngine({
      debounceMs: 100,
      normalizer: new Sanitizer(),
      writeValue: value => {
        writes.push(value);
        if (writes.length === 1) {
          firstWriteEntered.resolve();
        } else {
          secondWriteEntered.resolve();
        }
        return writes.length === 1 ? firstWrite.promise : secondWrite.promise;
      }
    });

    engine.schedule("<p>retry me</p>");
    const firstFlush = engine.flush();
    await firstWriteEntered.promise;
    expect(writes).toHaveLength(1);

    firstWrite.reject(new Error("first write failed"));
    await firstFlush.catch(() => undefined);

    engine.schedule("<p>retry me</p>");
    const secondFlush = engine.flush();
    await secondWriteEntered.promise;

    expect(writes).toHaveLength(2);

    secondWrite.resolve();
    await secondFlush;
  });

  it("rejects flush with the write failure and reports it exactly once", async () => {
    const write = deferred<void>();
    const writeEntered = deferred<void>();
    const failure = new Error("write failed");
    const onError = vi.fn();
    const engine = new SyncEngine({
      debounceMs: 100,
      normalizer: new Sanitizer(),
      writeValue: () => {
        writeEntered.resolve();
        return write.promise;
      },
      onError
    });

    engine.schedule("<p>value</p>");
    const flush = engine.flush();
    await writeEntered.promise;

    write.reject(failure);

    await expect(flush).rejects.toBe(failure);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBe(failure);
    expect(typeof onError.mock.calls[0]?.[1]).toBe("symbol");
  });

  it("treats an entered write as echo only until that write rejects", async () => {
    const write = deferred<void>();
    const writeEntered = deferred<void>();
    const engine = new SyncEngine({
      debounceMs: 100,
      normalizer: new Sanitizer(),
      writeValue: () => {
        writeEntered.resolve();
        return write.promise;
      }
    });

    engine.schedule("<p>in flight</p>");
    const flush = engine.flush();
    await writeEntered.promise;

    expect(engine.isEcho("<p>in flight</p>")).toBe(true);

    write.reject(new Error("write failed"));
    await flush.catch(() => undefined);

    expect(engine.isEcho("<p>in flight</p>")).toBe(false);
  });

  it("contains a synchronous success-observer failure without changing write success", async () => {
    const write = deferred<void>();
    const writeEntered = deferred<void>();
    const observerFailure = new Error("success observer failed");
    const onWriteSuccess = vi.fn(() => {
      throw observerFailure;
    });
    const onError = vi.fn();
    const engine = new SyncEngine({
      debounceMs: 100,
      normalizer: new Sanitizer(),
      writeValue: () => {
        writeEntered.resolve();
        return write.promise;
      },
      onWriteSuccess,
      onError
    });

    engine.schedule("<p>saved</p>");
    const flush = engine.flush();
    await writeEntered.promise;
    write.resolve();

    await expect(flush).resolves.toBeUndefined();
    expect(onWriteSuccess).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(engine.isEcho("<p>saved</p>")).toBe(true);
  });

  it("assimilates and contains an asynchronously rejected success-observer outcome", async () => {
    const write = deferred<void>();
    const writeEntered = deferred<void>();
    const observerFailure = new Error("async success observer failed");
    let observerAssimilated = false;
    const onWriteSuccess = vi.fn(() => ({
      then: (_resolve: () => void, reject: (reason: unknown) => void) => {
        observerAssimilated = true;
        window.setTimeout(() => reject(observerFailure), 0);
      }
    }));
    const onError = vi.fn();
    const engine = new SyncEngine({
      debounceMs: 100,
      normalizer: new Sanitizer(),
      writeValue: () => {
        writeEntered.resolve();
        return write.promise;
      },
      onWriteSuccess,
      onError
    });

    engine.schedule("<p>saved</p>");
    const flush = engine.flush();
    await writeEntered.promise;
    write.resolve();
    await flush;

    expect(observerAssimilated).toBe(true);
    await vi.advanceTimersByTimeAsync(0);

    expect(onWriteSuccess).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(engine.isEcho("<p>saved</p>")).toBe(true);
  });

  it("preserves the write rejection when the error observer throws synchronously", async () => {
    const write = deferred<void>();
    const writeEntered = deferred<void>();
    const writeFailure = new Error("write failed");
    const observerFailure = new Error("error observer failed");
    const onError = vi.fn(() => {
      throw observerFailure;
    });
    const engine = new SyncEngine({
      debounceMs: 100,
      normalizer: new Sanitizer(),
      writeValue: () => {
        writeEntered.resolve();
        return write.promise;
      },
      onError
    });

    engine.schedule("<p>failed</p>");
    const flush = engine.flush();
    await writeEntered.promise;
    write.reject(writeFailure);

    await expect(flush).rejects.toBe(writeFailure);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("assimilates an asynchronously rejected error-observer outcome while preserving the write rejection", async () => {
    const write = deferred<void>();
    const writeEntered = deferred<void>();
    const writeFailure = new Error("write failed");
    const observerFailure = new Error("async error observer failed");
    let observerAssimilated = false;
    const onError = vi.fn(() => ({
      then: (_resolve: () => void, reject: (reason: unknown) => void) => {
        observerAssimilated = true;
        window.setTimeout(() => reject(observerFailure), 0);
      }
    }));
    const engine = new SyncEngine({
      debounceMs: 100,
      normalizer: new Sanitizer(),
      writeValue: () => {
        writeEntered.resolve();
        return write.promise;
      },
      onError
    });

    engine.schedule("<p>failed</p>");
    const flush = engine.flush();
    await writeEntered.promise;
    write.reject(writeFailure);

    await expect(flush).rejects.toBe(writeFailure);
    expect(observerAssimilated).toBe(true);
    await vi.advanceTimersByTimeAsync(0);

    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("clears the failed in-flight echo before invoking the error observer", async () => {
    const write = deferred<void>();
    const writeEntered = deferred<void>();
    const failure = new Error("write failed");
    let echoDuringError: boolean | undefined;
    let engine: SyncEngine;
    const onError = vi.fn(() => {
      echoDuringError = engine.isEcho("<p>failed</p>");
    });
    engine = new SyncEngine({
      debounceMs: 100,
      normalizer: new Sanitizer(),
      writeValue: () => {
        writeEntered.resolve();
        return write.promise;
      },
      onError
    });

    engine.schedule("<p>failed</p>");
    const flush = engine.flush();
    await writeEntered.promise;
    write.reject(failure);

    await expect(flush).rejects.toBe(failure);
    expect(echoDuringError).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("does not treat an empty canonical value as echo without a baseline", () => {
    const engine = new SyncEngine({
      debounceMs: 100,
      normalizer: emptyNormalizer,
      writeValue: async () => {}
    });

    expect(engine.isEcho("")).toBe(false);
  });

  it("writes the first empty canonical value and suppresses it only after success", async () => {
    const writes: string[] = [];
    const engine = new SyncEngine({
      debounceMs: 100,
      normalizer: emptyNormalizer,
      writeValue: async value => {
        writes.push(value);
      }
    });

    engine.schedule("first raw value");
    await engine.flush();

    expect(writes).toEqual([""]);
    expect(engine.isEcho("host empty value")).toBe(true);

    engine.schedule("equivalent empty value");
    await engine.flush();
    expect(writes).toEqual([""]);
  });

  it("treats an aligned empty canonical host baseline as echo", async () => {
    const writes: string[] = [];
    const engine = new SyncEngine({
      debounceMs: 100,
      normalizer: emptyNormalizer,
      writeValue: async value => {
        writes.push(value);
      }
    });

    engine.alignToHost("host empty value");

    expect(engine.isEcho("")).toBe(true);
    engine.schedule("equivalent empty value");
    await engine.flush();
    expect(writes).toEqual([]);
  });

  it("debounces a single scheduled write", async () => {
    const writes: string[] = [];
    const engine = new SyncEngine({
      debounceMs: 100,
      normalizer: new Sanitizer(),
      writeValue: async value => {
        writes.push(value);
      }
    });

    engine.schedule("<p>single</p>");

    await vi.advanceTimersByTimeAsync(99);
    expect(writes).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(writes).toEqual(['<div data-rdx-content-root=""><p>single</p></div>']);
  });

  it("resets the debounce timer and writes only the latest rapid value", async () => {
    const writes: string[] = [];
    const engine = new SyncEngine({
      debounceMs: 100,
      normalizer: new Sanitizer(),
      writeValue: async value => {
        writes.push(value);
      }
    });

    engine.schedule("<p>first</p>");
    await vi.advanceTimersByTimeAsync(50);
    engine.schedule("<p>second</p>");

    await vi.advanceTimersByTimeAsync(99);
    expect(writes).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(writes).toEqual(['<div data-rdx-content-root=""><p>second</p></div>']);
  });

  it("serializes a second write behind an entered first write", async () => {
    const firstWrite = deferred<void>();
    const secondWrite = deferred<void>();
    const firstWriteEntered = deferred<void>();
    const secondWriteEntered = deferred<void>();
    const writes: string[] = [];
    const engine = new SyncEngine({
      debounceMs: 100,
      normalizer: new Sanitizer(),
      writeValue: value => {
        writes.push(value);
        if (writes.length === 1) {
          firstWriteEntered.resolve();
        } else {
          secondWriteEntered.resolve();
        }
        return writes.length === 1 ? firstWrite.promise : secondWrite.promise;
      }
    });

    engine.schedule("<p>A</p>");
    const firstFlush = engine.flush();
    await firstWriteEntered.promise;

    engine.schedule("<p>B</p>");
    const secondFlush = engine.flush();

    expect(writes).toEqual(['<div data-rdx-content-root=""><p>A</p></div>']);

    firstWrite.resolve();
    await secondWriteEntered.promise;

    expect(writes).toEqual([
      '<div data-rdx-content-root=""><p>A</p></div>',
      '<div data-rdx-content-root=""><p>B</p></div>'
    ]);
    expect(await settlesBeforeNextTimer(firstFlush)).toBe(true);

    secondWrite.resolve();
    await Promise.all([firstFlush, secondFlush]);
  });

  it("suppresses a duplicate canonical value after a successful write", async () => {
    const writes: string[] = [];
    const onWriteSuccess = vi.fn();
    const engine = new SyncEngine({
      debounceMs: 100,
      normalizer: new Sanitizer(),
      writeValue: async value => {
        writes.push(value);
      },
      onWriteSuccess
    });

    engine.schedule("<P>same</P>");
    await engine.flush();
    expect(engine.isEcho("<p>same</p>")).toBe(true);

    engine.schedule("<p>same</p>");
    await engine.flush();

    expect(writes).toEqual(['<div data-rdx-content-root=""><p>same</p></div>']);
    expect(onWriteSuccess).toHaveBeenCalledTimes(1);
    expect(onWriteSuccess.mock.calls[0]?.[0]).toBe(
      '<div data-rdx-content-root=""><p>same</p></div>'
    );
    expect(typeof onWriteSuccess.mock.calls[0]?.[1]).toBe("symbol");
  });

  it("reports the occurrence token for a physical write success", async () => {
    const request = Symbol("physical success") as SyncRequestToken;
    const onWriteSuccess = vi.fn();
    const engine = new SyncEngine({
      debounceMs: 100,
      normalizer: new Sanitizer(),
      writeValue: async () => {},
      onWriteSuccess
    });

    engine.schedule("<p>saved</p>", request);
    await engine.flush();

    expect(onWriteSuccess).toHaveBeenCalledTimes(1);
    expect(onWriteSuccess).toHaveBeenCalledWith(
      '<div data-rdx-content-root=""><p>saved</p></div>',
      request
    );
  });

  it("reports when an ordered occurrence is already satisfied without another write", async () => {
    const request = Symbol("already satisfied") as SyncRequestToken;
    const writes: string[] = [];
    const onWriteSuccess = vi.fn();
    const onAlreadySatisfied = vi.fn();
    const engine = new SyncEngine({
      debounceMs: 100,
      normalizer: new Sanitizer(),
      writeValue: async value => {
        writes.push(value);
      },
      onWriteSuccess,
      onAlreadySatisfied
    });

    engine.alignToHost("<p>same</p>");
    engine.schedule("<P>same</P>", request);
    await engine.flush();

    expect(writes).toEqual([]);
    expect(onWriteSuccess).not.toHaveBeenCalled();
    expect(onAlreadySatisfied).toHaveBeenCalledTimes(1);
    expect(onAlreadySatisfied).toHaveBeenCalledWith(request);
  });

  it("keeps duplicate queued occurrences distinct through failure and retry", async () => {
    const oldRequest = Symbol("old A") as SyncRequestToken;
    const currentRequest = Symbol("current A") as SyncRequestToken;
    const oldWrite = deferred<void>();
    const currentWrite = deferred<void>();
    const oldWriteEntered = deferred<void>();
    const currentWriteEntered = deferred<void>();
    const onError = vi.fn();
    const onWriteSuccess = vi.fn();
    let writeCount = 0;
    const engine = new SyncEngine({
      debounceMs: 100,
      normalizer: new Sanitizer(),
      writeValue: () => {
        writeCount += 1;
        if (writeCount === 1) {
          oldWriteEntered.resolve();
          return oldWrite.promise;
        }
        currentWriteEntered.resolve();
        return currentWrite.promise;
      },
      onError,
      onWriteSuccess
    });

    engine.schedule("<p>A</p>", oldRequest);
    const oldFlush = engine.flush();
    await oldWriteEntered.promise;

    engine.schedule("<p>A</p>", currentRequest);
    const currentFlush = engine.flush();
    oldWrite.reject(new Error("old A failed"));
    await oldFlush.catch(() => undefined);
    await currentWriteEntered.promise;

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[1]).toBe(oldRequest);

    currentWrite.resolve();
    await currentFlush.catch(() => undefined);
    expect(onWriteSuccess).toHaveBeenCalledTimes(1);
    expect(onWriteSuccess.mock.calls[0]?.[1]).toBe(currentRequest);
  });

  it("does not let an outer normalization completion replace a reentrant newer schedule", async () => {
    const outerRequest = Symbol("outer") as SyncRequestToken;
    const newerRequest = Symbol("newer") as SyncRequestToken;
    const writes: string[] = [];
    const onWriteSuccess = vi.fn();
    let reentered = false;
    let engine: SyncEngine;
    const normalizer: HtmlNormalizer = {
      normalizeHtml: value => {
        if (value === "outer" && !reentered) {
          reentered = true;
          engine.schedule("newer", newerRequest);
        }
        return value ?? "";
      }
    };
    engine = new SyncEngine({
      debounceMs: 100,
      normalizer,
      writeValue: async value => {
        writes.push(value);
      },
      onWriteSuccess
    });

    engine.schedule("outer", outerRequest);
    await engine.flush();

    expect(writes).toEqual(["newer"]);
    expect(onWriteSuccess).toHaveBeenCalledTimes(1);
    expect(onWriteSuccess.mock.calls[0]?.[1]).toBe(newerRequest);
  });

  it("contains an already-satisfied observer failure without changing flush success", async () => {
    const observerFailure = new Error("already-satisfied observer failed");
    const engine = new SyncEngine({
      debounceMs: 100,
      normalizer: new Sanitizer(),
      writeValue: async () => {},
      onAlreadySatisfied: () => {
        throw observerFailure;
      }
    });

    engine.alignToHost("<p>same</p>");
    engine.schedule("<p>same</p>", Symbol("same") as SyncRequestToken);

    await expect(engine.flush()).resolves.toBeUndefined();
    expect(engine.isEcho("<p>same</p>")).toBe(true);
  });

  it("flushes a pending value before its debounce timer", async () => {
    const writes: string[] = [];
    const engine = new SyncEngine({
      debounceMs: 100,
      normalizer: new Sanitizer(),
      writeValue: async value => {
        writes.push(value);
      }
    });

    engine.schedule("<p>now</p>");
    await engine.flush();

    expect(writes).toEqual(['<div data-rdx-content-root=""><p>now</p></div>']);

    await vi.advanceTimersByTimeAsync(100);
    expect(writes).toHaveLength(1);
  });

  it("propagates an in-flight failure through a flush snapshot", async () => {
    const write = deferred<void>();
    const writeEntered = deferred<void>();
    const failure = new Error("in-flight write failed");
    const engine = new SyncEngine({
      debounceMs: 100,
      normalizer: new Sanitizer(),
      writeValue: () => {
        writeEntered.resolve();
        return write.promise;
      }
    });

    engine.schedule("<p>A</p>");
    const originalFlush = engine.flush();
    const handledOriginalFlush = originalFlush.catch(() => undefined);
    await writeEntered.promise;

    const snapshot = engine.flush();
    write.reject(failure);

    await handledOriginalFlush;
    await expect(snapshot).rejects.toBe(failure);
  });

  it("propagates a serialized predecessor failure when flushing a queued successor", async () => {
    const firstWrite = deferred<void>();
    const secondWrite = deferred<void>();
    const firstWriteEntered = deferred<void>();
    const secondWriteEntered = deferred<void>();
    const failure = new Error("predecessor failed");
    const writes: string[] = [];
    const engine = new SyncEngine({
      debounceMs: 100,
      normalizer: new Sanitizer(),
      writeValue: value => {
        writes.push(value);
        if (writes.length === 1) {
          firstWriteEntered.resolve();
        } else {
          secondWriteEntered.resolve();
        }
        return writes.length === 1 ? firstWrite.promise : secondWrite.promise;
      }
    });

    engine.schedule("<p>A</p>");
    const firstFlush = engine.flush();
    const handledFirstFlush = firstFlush.catch(() => undefined);
    await firstWriteEntered.promise;

    engine.schedule("<p>B</p>");
    const queuedFlush = engine.flush();
    const queuedFlushError = queuedFlush.catch(error => error);

    firstWrite.reject(failure);
    await handledFirstFlush;
    await secondWriteEntered.promise;

    expect(writes).toEqual([
      '<div data-rdx-content-root=""><p>A</p></div>',
      '<div data-rdx-content-root=""><p>B</p></div>'
    ]);
    expect(await settlesBeforeNextTimer(queuedFlush)).toBe(false);

    secondWrite.resolve();
    expect(await queuedFlushError).toBe(failure);
  });

  it("contains a timer-path rejection and recovers for a later timer write", async () => {
    const firstWrite = deferred<void>();
    const secondWrite = deferred<void>();
    const firstWriteEntered = deferred<void>();
    const secondWriteEntered = deferred<void>();
    const errorReported = deferred<unknown>();
    const failure = new Error("timer write failed");
    const writes: string[] = [];
    const onError = vi.fn((error: unknown, _request: SyncRequestToken) => {
      errorReported.resolve(error);
    });
    const engine = new SyncEngine({
      debounceMs: 100,
      normalizer: new Sanitizer(),
      writeValue: value => {
        writes.push(value);
        if (writes.length === 1) {
          firstWriteEntered.resolve();
        } else {
          secondWriteEntered.resolve();
        }
        return writes.length === 1 ? firstWrite.promise : secondWrite.promise;
      },
      onError
    });

    engine.schedule("<p>A</p>");
    await vi.advanceTimersByTimeAsync(100);
    await firstWriteEntered.promise;
    expect(writes).toEqual(['<div data-rdx-content-root=""><p>A</p></div>']);

    firstWrite.reject(failure);
    expect(await errorReported.promise).toBe(failure);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBe(failure);
    expect(typeof onError.mock.calls[0]?.[1]).toBe("symbol");

    engine.schedule("<p>B</p>");
    await vi.advanceTimersByTimeAsync(100);
    await secondWriteEntered.promise;
    expect(writes).toEqual([
      '<div data-rdx-content-root=""><p>A</p></div>',
      '<div data-rdx-content-root=""><p>B</p></div>'
    ]);

    secondWrite.resolve();
    await engine.flush();
  });

  it("rejects an idle flush with a settled timer failure without retrying", async () => {
    const failure = new Error("settled timer write failed");
    const errorReported = deferred<void>();
    const writes: string[] = [];
    const engine = new SyncEngine({
      debounceMs: 100,
      normalizer: new Sanitizer(),
      writeValue: async value => {
        writes.push(value);
        throw failure;
      },
      onError: () => {
        errorReported.resolve();
      }
    });

    engine.schedule("<p>failed once</p>");
    await vi.advanceTimersByTimeAsync(100);
    await errorReported.promise;
    await Promise.resolve();
    await Promise.resolve();

    await expect(engine.flush()).rejects.toBe(failure);
    expect(writes).toEqual([
      '<div data-rdx-content-root=""><p>failed once</p></div>'
    ]);
  });

  it("clears a settled timer failure after the next edit succeeds", async () => {
    const failure = new Error("first timer write failed");
    const firstFailureReported = deferred<void>();
    const recoveryWrite = deferred<void>();
    const recoveryWriteEntered = deferred<void>();
    const writes: string[] = [];
    const engine = new SyncEngine({
      debounceMs: 100,
      normalizer: new Sanitizer(),
      writeValue: value => {
        writes.push(value);
        if (writes.length === 1) {
          return Promise.reject(failure);
        }

        recoveryWriteEntered.resolve();
        return recoveryWrite.promise;
      },
      onError: () => firstFailureReported.resolve()
    });

    engine.schedule("<p>failed edit</p>");
    await vi.advanceTimersByTimeAsync(100);
    await firstFailureReported.promise;

    engine.schedule("<p>recovered edit</p>");
    const recoveryFlush = engine.flush();
    await recoveryWriteEntered.promise;

    expect(await settlesBeforeNextTimer(recoveryFlush)).toBe(false);
    recoveryWrite.resolve();
    await recoveryFlush;

    await expect(engine.flush()).resolves.toBeUndefined();
    expect(writes).toEqual([
      '<div data-rdx-content-root=""><p>failed edit</p></div>',
      '<div data-rdx-content-root=""><p>recovered edit</p></div>'
    ]);
  });

  it("clears a settled timer failure when explicit host alignment supersedes it", async () => {
    const failure = new Error("aligned timer write failed");
    const errorReported = deferred<void>();
    const writeValue = vi.fn(async () => {
      throw failure;
    });
    const engine = new SyncEngine({
      debounceMs: 100,
      normalizer: new Sanitizer(),
      writeValue,
      onError: () => errorReported.resolve()
    });

    engine.schedule("<p>failed edit</p>");
    await vi.advanceTimersByTimeAsync(100);
    await errorReported.promise;

    engine.alignToHost("<p>host value</p>");

    await expect(engine.flush()).resolves.toBeUndefined();
    expect(writeValue).toHaveBeenCalledTimes(1);
    expect(engine.isEcho("<p>host value</p>")).toBe(true);
  });

  it("clears a settled timer failure when disposal supersedes it", async () => {
    const failure = new Error("disposed timer write failed");
    const errorReported = deferred<void>();
    const writeValue = vi.fn(async () => {
      throw failure;
    });
    const engine = new SyncEngine({
      debounceMs: 100,
      normalizer: new Sanitizer(),
      writeValue,
      onError: () => errorReported.resolve()
    });

    engine.schedule("<p>failed edit</p>");
    await vi.advanceTimersByTimeAsync(100);
    await errorReported.promise;

    engine.dispose();

    await expect(engine.flush()).resolves.toBeUndefined();
    expect(writeValue).toHaveBeenCalledTimes(1);
  });

  it("retains a failed predecessor after a timer serializes its successor", async () => {
    const firstWrite = deferred<void>();
    const secondWrite = deferred<void>();
    const firstWriteEntered = deferred<void>();
    const secondWriteEntered = deferred<void>();
    const failure = new Error("timer predecessor failed");
    const writes: string[] = [];
    const engine = new SyncEngine({
      debounceMs: 100,
      normalizer: new Sanitizer(),
      writeValue: value => {
        writes.push(value);
        if (writes.length === 1) {
          firstWriteEntered.resolve();
          return firstWrite.promise;
        }

        secondWriteEntered.resolve();
        return secondWrite.promise;
      }
    });

    engine.schedule("<p>A</p>");
    const firstFlush = engine.flush();
    const handledFirstFlush = firstFlush.catch(() => undefined);
    await firstWriteEntered.promise;

    engine.schedule("<p>B</p>");
    await vi.advanceTimersByTimeAsync(100);

    const snapshot = engine.flush();
    let snapshotSettled = false;
    const snapshotError = snapshot.then(
      () => {
        snapshotSettled = true;
        return undefined;
      },
      error => {
        snapshotSettled = true;
        return error;
      }
    );

    firstWrite.reject(failure);
    await handledFirstFlush;
    await secondWriteEntered.promise;

    expect(snapshotSettled).toBe(false);
    expect(writes).toEqual([
      '<div data-rdx-content-root=""><p>A</p></div>',
      '<div data-rdx-content-root=""><p>B</p></div>'
    ]);

    secondWrite.resolve();
    expect(await snapshotError).toBe(failure);
  });

  it("aligns to the host while cancelling a queued value and its timer", async () => {
    const writes: string[] = [];
    const engine = new SyncEngine({
      debounceMs: 100,
      normalizer: new Sanitizer(),
      writeValue: async value => {
        writes.push(value);
      }
    });

    engine.schedule("<p>A</p>");
    engine.alignToHost("<p>B</p>");

    await engine.flush();
    expect(writes).toEqual([]);

    expect(engine.isEcho("<P>B</P>")).toBe(true);
    expect(engine.isEcho("<p>A</p>")).toBe(false);

    await vi.advanceTimersByTimeAsync(100);
    expect(writes).toEqual([]);
  });

  it("keeps an aligned host baseline when an older entered write completes", async () => {
    const write = deferred<void>();
    const writeEntered = deferred<void>();
    const onWriteSuccess = vi.fn();
    const engine = new SyncEngine({
      debounceMs: 100,
      normalizer: new Sanitizer(),
      writeValue: () => {
        writeEntered.resolve();
        return write.promise;
      },
      onWriteSuccess
    });

    engine.schedule("<p>A</p>");
    const flush = engine.flush();
    await writeEntered.promise;

    engine.alignToHost("<p>B</p>");
    write.resolve();
    await flush;

    expect(onWriteSuccess).not.toHaveBeenCalled();
    expect(engine.isEcho("<p>B</p>")).toBe(true);
    expect(engine.isEcho("<p>A</p>")).toBe(false);
  });

  it("makes a bare post-align flush independent of a stale entered failure", async () => {
    const write = deferred<void>();
    const writeEntered = deferred<void>();
    const failure = new Error("stale aligned write failed");
    const onError = vi.fn();
    const engine = new SyncEngine({
      debounceMs: 100,
      normalizer: new Sanitizer(),
      writeValue: () => {
        writeEntered.resolve();
        return write.promise;
      },
      onError
    });

    engine.schedule("<p>A</p>");
    const staleFlush = engine.flush();
    await writeEntered.promise;

    engine.alignToHost("<p>B</p>");
    const currentFlush = engine.flush();
    const currentFlushWasPrompt = await settlesBeforeNextTimer(currentFlush);
    const staleFlushWasPrompt = await settlesBeforeNextTimer(staleFlush);

    write.reject(failure);
    await expect(staleFlush).rejects.toBe(failure);
    await currentFlush;

    expect(currentFlushWasPrompt).toBe(true);
    expect(staleFlushWasPrompt).toBe(false);
    expect(onError).not.toHaveBeenCalled();
    expect(engine.isEcho("<p>B</p>")).toBe(true);
  });

  it("skips a timer-enqueued stale value after align while keeping new work behind the entered write", async () => {
    const staleWrite = deferred<void>();
    const currentWrite = deferred<void>();
    const staleWriteEntered = deferred<void>();
    const currentWriteEntered = deferred<void>();
    const writes: string[] = [];
    const engine = new SyncEngine({
      debounceMs: 100,
      normalizer: new Sanitizer(),
      writeValue: value => {
        writes.push(value);
        if (writes.length === 1) {
          staleWriteEntered.resolve();
          return staleWrite.promise;
        }

        currentWriteEntered.resolve();
        return currentWrite.promise;
      }
    });

    engine.schedule("<p>A</p>");
    const staleFlush = engine.flush();
    await staleWriteEntered.promise;

    engine.schedule("<p>B</p>");
    await vi.advanceTimersByTimeAsync(100);
    engine.alignToHost("<p>host</p>");

    engine.schedule("<p>C</p>");
    const currentFlush = engine.flush();
    expect(writes).toEqual(['<div data-rdx-content-root=""><p>A</p></div>']);

    staleWrite.resolve();
    await currentWriteEntered.promise;

    expect(writes).toEqual([
      '<div data-rdx-content-root=""><p>A</p></div>',
      '<div data-rdx-content-root=""><p>C</p></div>'
    ]);

    currentWrite.resolve();
    await Promise.all([staleFlush, currentFlush]);
  });

  it("disposes before debounce without entering the host write", async () => {
    const writes: string[] = [];
    const engine = new SyncEngine({
      debounceMs: 100,
      normalizer: new Sanitizer(),
      writeValue: async value => {
        writes.push(value);
      }
    });

    engine.schedule("<p>A</p>");
    engine.dispose();

    await vi.advanceTimersByTimeAsync(100);
    expect(writes).toEqual([]);
  });

  it("allows an entered write to finish after dispose without a success callback", async () => {
    const write = deferred<void>();
    const writeEntered = deferred<void>();
    const onWriteSuccess = vi.fn();
    const onError = vi.fn();
    const engine = new SyncEngine({
      debounceMs: 100,
      normalizer: new Sanitizer(),
      writeValue: () => {
        writeEntered.resolve();
        return write.promise;
      },
      onWriteSuccess,
      onError
    });

    engine.schedule("<p>A</p>");
    const flush = engine.flush();
    await writeEntered.promise;

    engine.dispose();
    write.resolve();
    await flush;

    expect(onWriteSuccess).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("allows an entered write to reject after dispose without an error callback", async () => {
    const write = deferred<void>();
    const writeEntered = deferred<void>();
    const failure = new Error("disposed write failed");
    const onWriteSuccess = vi.fn();
    const onError = vi.fn();
    const engine = new SyncEngine({
      debounceMs: 100,
      normalizer: new Sanitizer(),
      writeValue: () => {
        writeEntered.resolve();
        return write.promise;
      },
      onWriteSuccess,
      onError
    });

    engine.schedule("<p>A</p>");
    const flush = engine.flush();
    await writeEntered.promise;

    engine.dispose();
    write.reject(failure);

    await expect(flush).rejects.toBe(failure);
    expect(onWriteSuccess).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("makes a new flush after dispose independent of an entered write", async () => {
    const write = deferred<void>();
    const writeEntered = deferred<void>();
    const engine = new SyncEngine({
      debounceMs: 100,
      normalizer: new Sanitizer(),
      writeValue: () => {
        writeEntered.resolve();
        return write.promise;
      }
    });

    engine.schedule("<p>A</p>");
    const staleFlush = engine.flush();
    await writeEntered.promise;

    engine.dispose();
    const disposedFlush = engine.flush();
    const disposedFlushWasPrompt = await settlesBeforeNextTimer(disposedFlush);
    const staleFlushWasPrompt = await settlesBeforeNextTimer(staleFlush);

    write.resolve();
    await Promise.all([staleFlush, disposedFlush]);

    expect(disposedFlushWasPrompt).toBe(true);
    expect(staleFlushWasPrompt).toBe(false);
  });

  it("skips a flush-enqueued value that has not entered before dispose", async () => {
    const write = deferred<void>();
    const writeEntered = deferred<void>();
    const writes: string[] = [];
    const engine = new SyncEngine({
      debounceMs: 100,
      normalizer: new Sanitizer(),
      writeValue: value => {
        writes.push(value);
        writeEntered.resolve();
        return write.promise;
      }
    });

    engine.schedule("<p>A</p>");
    const enteredFlush = engine.flush();
    await writeEntered.promise;

    engine.schedule("<p>B</p>");
    const queuedFlush = engine.flush();
    engine.dispose();

    write.resolve();
    await Promise.all([enteredFlush, queuedFlush]);

    expect(writes).toEqual(['<div data-rdx-content-root=""><p>A</p></div>']);
  });

  it("does not schedule host writes after dispose", async () => {
    const writes: string[] = [];
    const normalizeHtml = vi.fn((value: string | null | undefined) => value ?? "");
    const engine = new SyncEngine({
      debounceMs: 100,
      normalizer: { normalizeHtml },
      writeValue: async value => {
        writes.push(value);
      }
    });

    engine.dispose();
    engine.schedule("<p>A</p>");

    expect(normalizeHtml).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(100);
    await engine.flush();

    expect(writes).toEqual([]);
  });

  it("recognizes equivalent host serialization without hiding content loss", async () => {
    const write = deferred<void>();
    const writeEntered = deferred<void>();
    const engine = new SyncEngine({
      debounceMs: 100,
      normalizer: new Sanitizer(),
      writeValue: () => {
        writeEntered.resolve();
        return write.promise;
      }
    });

    engine.schedule('<p class="keep" style="color: red">Text</p>');
    const flush = engine.flush();
    await writeEntered.promise;

    expect(
      engine.isEcho('<P style="color:red;" class="keep">Text</P>')
    ).toBe(true);
    expect(engine.isEcho('<p class="keep" style="color:red"></p>')).toBe(false);
    expect(engine.isEcho('<p style="color:red">Text</p>')).toBe(false);
    expect(engine.isEcho('<p class="keep">Text</p>')).toBe(false);

    write.resolve();
    await flush;
  });
});
