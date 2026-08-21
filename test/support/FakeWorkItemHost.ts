import type {
  IWorkItemChangedArgs,
  IWorkItemFieldChangedArgs,
  IWorkItemLoadedArgs,
  IWorkItemNotificationListener
} from "azure-devops-extension-api/WorkItemTracking";

import type { WorkItemPort } from "../../src/control/RoosterDescriptionControl";

export type FakeWriteEcho = "none" | "immediate" | "delayed";

export interface FakeWorkItemHostOptions {
  readonly fields?: Readonly<Record<string, string>>;
  readonly id?: number;
  readonly readOnly?: boolean;
  readonly workItemType?: string;
  readonly writeEcho?: FakeWriteEcho;
}

export interface FakeReadLogEntry {
  readonly fieldName: string;
  value?: string;
  outcome: "pending" | "succeeded" | "failed";
}

export interface FakeWriteLogEntry {
  readonly fieldName: string;
  readonly value: string;
  outcome: "pending" | "succeeded" | "failed";
}

export interface DeferredFieldRead {
  readonly promise: Promise<string>;
  resolve(value: string): void;
  reject(reason?: unknown): void;
}

export interface DeferredWrite {
  readonly entered: Promise<void>;
  resolve(): void;
  reject(reason?: unknown): void;
}

type ReadPlan = () => Promise<string>;

interface DeferredWritePlan extends DeferredWrite {
  readonly completion: Promise<void>;
  markEntered(): void;
}

const SHA256_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
] as const;

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function sha256Text(value: string): string {
  const input = new TextEncoder().encode(value);
  const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
  const bytes = new Uint8Array(paddedLength);
  bytes.set(input);
  bytes[input.length] = 0x80;
  const bitLength = input.length * 8;
  const view = new DataView(bytes.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  const hash = new Uint32Array([
    0x6a09e667,
    0xbb67ae85,
    0x3c6ef372,
    0xa54ff53a,
    0x510e527f,
    0x9b05688c,
    0x1f83d9ab,
    0x5be0cd19
  ]);
  const words = new Uint32Array(64);

  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const word15 = words[index - 15];
      const word2 = words[index - 2];
      const sigma0 = rotateRight(word15, 7) ^ rotateRight(word15, 18) ^ (word15 >>> 3);
      const sigma1 = rotateRight(word2, 17) ^ rotateRight(word2, 19) ^ (word2 >>> 10);
      words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
    }

    let a = hash[0];
    let b = hash[1];
    let c = hash[2];
    let d = hash[3];
    let e = hash[4];
    let f = hash[5];
    let g = hash[6];
    let h = hash[7];

    for (let index = 0; index < 64; index += 1) {
      const sigma1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const first = (h + sigma1 + choice + SHA256_CONSTANTS[index] + words[index]) >>> 0;
      const sigma0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const second = (sigma0 + majority) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + first) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (first + second) >>> 0;
    }

    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }

  return Array.from(hash, word => word.toString(16).padStart(8, "0")).join("");
}

function createDeferredFieldRead(): DeferredFieldRead {
  let resolvePromise!: (value: string) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<string>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise
  };
}

function createDeferredWrite(): DeferredWritePlan {
  let markEntered!: () => void;
  let resolveCompletion!: () => void;
  let rejectCompletion!: (reason?: unknown) => void;
  const entered = new Promise<void>(resolve => {
    markEntered = resolve;
  });
  const completion = new Promise<void>((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });

  return {
    completion,
    entered,
    markEntered,
    resolve: resolveCompletion,
    reject: rejectCompletion
  };
}

async function invokeListener(callback: () => void): Promise<void> {
  await (callback() as unknown as Promise<void> | void);
}

export class FakeWorkItemHost implements WorkItemPort {
  readonly reads: FakeReadLogEntry[] = [];
  readonly writes: FakeWriteLogEntry[] = [];
  readonly events: string[] = [];
  readonly fieldChecks: string[] = [];

  private readonly id: number;
  private readonly fields = new Map<string, string>();
  private savedFields = new Map<string, string>();
  private readonly readPlans = new Map<string, ReadPlan[]>();
  private readonly readWaiters = new Map<
    string,
    Array<{ readonly occurrence: number; resolve(): void }>
  >();
  private readonly writeFailures: unknown[] = [];
  private readonly writePlans: DeferredWritePlan[] = [];
  private readonly delayedEchoes: IWorkItemFieldChangedArgs[] = [];
  private readonly logListeners = new Set<() => void>();
  private listener: IWorkItemNotificationListener | null = null;
  private readOnly: boolean;
  private writeEcho: FakeWriteEcho;

  constructor(options: FakeWorkItemHostOptions = {}) {
    this.id = options.id ?? 123;
    this.readOnly = options.readOnly ?? false;
    this.writeEcho = options.writeEcho ?? "none";
    Object.entries(options.fields ?? {}).forEach(([fieldName, value]) => {
      this.fields.set(fieldName, value);
    });
    this.fields.set(
      "System.WorkItemType",
      options.workItemType ?? this.fields.get("System.WorkItemType") ?? "SRS"
    );
    this.savedFields = new Map(this.fields);
  }

  attach(listener: IWorkItemNotificationListener): void {
    this.listener = listener;
  }

  onLogChange(listener: () => void): () => void {
    this.logListeners.add(listener);
    return () => {
      this.logListeners.delete(listener);
    };
  }

  async getFieldValue(fieldName: string): Promise<string> {
    const entry: FakeReadLogEntry = { fieldName, outcome: "pending" };
    this.reads.push(entry);
    this.notifyLogChange();
    this.resolveReadWaiters(fieldName);
    const plans = this.readPlans.get(fieldName);
    const plan = plans?.shift();
    if (plans?.length === 0) {
      this.readPlans.delete(fieldName);
    }

    try {
      const value = plan ? await plan() : this.getRawField(fieldName);
      entry.value = value;
      entry.outcome = "succeeded";
      this.notifyLogChange();
      return value;
    } catch (error) {
      entry.outcome = "failed";
      this.notifyLogChange();
      throw error;
    }
  }

  async setFieldValue(fieldName: string, value: string): Promise<void> {
    const entry: FakeWriteLogEntry = { fieldName, value, outcome: "pending" };
    this.writes.push(entry);
    this.notifyLogChange();
    const failure = this.writeFailures.shift();
    if (failure !== undefined) {
      entry.outcome = "failed";
      this.notifyLogChange();
      throw failure;
    }

    const writePlan = this.writePlans.shift();
    if (writePlan) {
      writePlan.markEntered();
      try {
        await writePlan.completion;
      } catch (error) {
        entry.outcome = "failed";
        this.notifyLogChange();
        throw error;
      }
    }

    this.fields.set(fieldName, value);
    const args = this.fieldChangedArgs({ [fieldName]: value });
    if (this.writeEcho === "immediate" && this.listener) {
      this.events.push(`echo:${fieldName}:immediate`);
      await invokeListener(() => this.listener?.onFieldChanged(args));
    }

    entry.outcome = "succeeded";
    this.notifyLogChange();
    if (this.writeEcho === "delayed") {
      this.delayedEchoes.push(args);
    }
  }

  async getWorkItemType(): Promise<string> {
    return this.getFieldValue("System.WorkItemType");
  }

  hasFieldChanged(args: IWorkItemFieldChangedArgs, fieldName: string): boolean {
    this.fieldChecks.push(fieldName);
    return Object.prototype.hasOwnProperty.call(args.changedFields || {}, fieldName);
  }

  getRawField(fieldName: string): string {
    return this.fields.get(fieldName) ?? "";
  }

  getFields(): Readonly<Record<string, string>> {
    return Object.fromEntries(this.fields);
  }

  sha256(fieldName: string): string {
    return sha256Text(this.getRawField(fieldName));
  }

  setRawField(fieldName: string, value: string): void {
    this.fields.set(fieldName, value);
    this.notifyLogChange();
  }

  captureSavedState(): void {
    this.savedFields = new Map(this.fields);
    this.notifyLogChange();
  }

  setWorkItemType(workItemType: string): void {
    this.fields.set("System.WorkItemType", workItemType);
  }

  setReadOnly(readOnly: boolean): void {
    this.readOnly = readOnly;
  }

  setWriteEcho(writeEcho: FakeWriteEcho): void {
    this.writeEcho = writeEcho;
  }

  failNextWrite(error: unknown = new Error("Synthetic write failure")): void {
    this.writeFailures.push(error);
  }

  deferNextRead(fieldName: string): DeferredFieldRead {
    const deferred = createDeferredFieldRead();
    this.queueRead(fieldName, () => deferred.promise);
    return deferred;
  }

  deferNextWrite(): DeferredWrite {
    const deferred = createDeferredWrite();
    this.writePlans.push(deferred);
    return deferred;
  }

  waitForRead(fieldName: string, occurrence = 1): Promise<void> {
    const count = this.reads.filter(read => read.fieldName === fieldName).length;
    if (count >= occurrence) {
      return Promise.resolve();
    }

    return new Promise(resolve => {
      const waiters = this.readWaiters.get(fieldName) ?? [];
      waiters.push({ occurrence, resolve });
      this.readWaiters.set(fieldName, waiters);
    });
  }

  queueReadValue(fieldName: string, value: string): void {
    this.queueRead(fieldName, async () => value);
  }

  queueReadFailure(fieldName: string, error: unknown): void {
    this.queueRead(fieldName, async () => {
      throw error;
    });
  }

  clearLog(): void {
    this.reads.length = 0;
    this.writes.length = 0;
    this.events.length = 0;
    this.fieldChecks.length = 0;
    this.notifyLogChange();
  }

  async load(): Promise<void> {
    this.events.push("load");
    this.notifyLogChange();
    const args: IWorkItemLoadedArgs = {
      id: this.id,
      isNew: false,
      isReadOnly: this.readOnly
    };
    await invokeListener(() => this.requireListener().onLoaded(args));
  }

  async reload(): Promise<void> {
    this.events.push("reload");
    this.notifyLogChange();
    const args: IWorkItemLoadedArgs = {
      id: this.id,
      isNew: false,
      isReadOnly: this.readOnly
    };
    await invokeListener(() => this.requireListener().onLoaded(args));
  }

  async changeFields(changes: Readonly<Record<string, string>>): Promise<void> {
    Object.entries(changes).forEach(([fieldName, value]) => {
      this.fields.set(fieldName, value);
    });
    await this.emitFieldChanged({ ...changes });
  }

  async emitFieldChanged(changedFields: Record<string, unknown>): Promise<void> {
    this.events.push(`field-change:${Object.keys(changedFields).join(",")}`);
    this.notifyLogChange();
    const args = this.fieldChangedArgs(changedFields);
    await invokeListener(() => this.requireListener().onFieldChanged(args));
  }

  async deliverDelayedEchoes(): Promise<void> {
    while (this.delayedEchoes.length > 0) {
      const args = this.delayedEchoes.shift();
      if (!args) {
        continue;
      }
      this.events.push(`echo:${Object.keys(args.changedFields).join(",")}:delayed`);
      this.notifyLogChange();
      await invokeListener(() => this.requireListener().onFieldChanged(args));
    }
  }

  async save(): Promise<void> {
    this.events.push("save");
    this.notifyLogChange();
    await invokeListener(() => this.requireListener().onSaved(this.changedArgs()));
    this.savedFields = new Map(this.fields);
  }

  async refresh(): Promise<void> {
    this.events.push("refresh");
    this.notifyLogChange();
    await invokeListener(() => this.requireListener().onRefreshed(this.changedArgs()));
  }

  async reset(): Promise<void> {
    this.events.push("reset");
    this.notifyLogChange();
    this.fields.clear();
    this.savedFields.forEach((value, fieldName) => this.fields.set(fieldName, value));
    await invokeListener(() => this.requireListener().onReset(this.changedArgs()));
  }

  async unload(): Promise<void> {
    this.events.push("unload");
    this.notifyLogChange();
    await invokeListener(() => this.requireListener().onUnloaded(this.changedArgs()));
  }

  private queueRead(fieldName: string, plan: ReadPlan): void {
    const plans = this.readPlans.get(fieldName) ?? [];
    plans.push(plan);
    this.readPlans.set(fieldName, plans);
  }

  private resolveReadWaiters(fieldName: string): void {
    const waiters = this.readWaiters.get(fieldName);
    if (!waiters) {
      return;
    }
    const count = this.reads.filter(read => read.fieldName === fieldName).length;
    const retained = waiters.filter(waiter => {
      if (count >= waiter.occurrence) {
        waiter.resolve();
        return false;
      }
      return true;
    });
    if (retained.length > 0) {
      this.readWaiters.set(fieldName, retained);
    } else {
      this.readWaiters.delete(fieldName);
    }
  }

  private notifyLogChange(): void {
    [...this.logListeners].forEach(listener => {
      try {
        listener();
      } catch {
        // Diagnostics are observers and cannot alter the fake host boundary.
      }
    });
  }

  private requireListener(): IWorkItemNotificationListener {
    if (!this.listener) {
      throw new Error("Attach a Work Item notification listener before simulating lifecycle events.");
    }
    return this.listener;
  }

  private changedArgs(): IWorkItemChangedArgs {
    return { id: this.id };
  }

  private fieldChangedArgs(
    changedFields: Record<string, unknown>
  ): IWorkItemFieldChangedArgs {
    return { id: this.id, changedFields };
  }
}
