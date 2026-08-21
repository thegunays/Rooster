import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  IWorkItemChangedArgs,
  IWorkItemFieldChangedArgs,
  IWorkItemLoadedArgs
} from "azure-devops-extension-api/WorkItemTracking";

const sdk = vi.hoisted(() => ({
  getConfiguration: vi.fn(() => ({
    witInputs: { FieldName: "Custom.RoosterContent", EnabledWits: "SRS,HLD" }
  })),
  getHost: vi.fn(() => ({ isHosted: true })),
  getExtensionContext: vi.fn(() => ({ version: "9.8.7" })),
  getService: vi.fn()
}));

vi.mock("azure-devops-extension-sdk", () => sdk);
vi.mock("azure-devops-extension-api/WorkItemTracking", () => ({
  WorkItemTrackingServiceIds: { WorkItemFormService: "work-item-form-service" }
}));

import { Sanitizer, type HtmlNormalizer } from "../../src/bridge/Sanitizer";
import {
  SyncEngine,
  type SyncEngineOptions,
  type SyncRequestToken
} from "../../src/bridge/SyncEngine";
import { getControlConfig } from "../../src/config/defaults";
import {
  RoosterDescriptionControl,
  type ControllerDependencies,
  type SyncPort,
  type WorkItemPort
} from "../../src/control/RoosterDescriptionControl";
import { createReadOnlyView } from "../../src/control/ReadOnlyView";
import type { ReadOnlyView } from "../../src/control/ReadOnlyView";
import type { EditorHost, RoosterHostOptions } from "../../src/control/RoosterHost";
import { TelemetryClient } from "../../src/telemetry/TelemetryClient";

type TelemetryPayload = {
  eventName: string;
  properties: Record<string, string | number | boolean>;
};

function last<T>(values: readonly T[]): T | undefined {
  return values[values.length - 1];
}

class FakeEditor implements EditorHost {
  readonly html: string[] = [];
  readonly statuses: string[] = [];
  readonly readOnlyValues: boolean[] = [];
  readonly lifecycle: string[];
  disposeCount = 0;
  unsubscribeCount = 0;
  statusError: unknown;
  unsubscribeError: unknown;
  disposeError: unknown;
  onSetHtml: (() => void) | undefined;
  onSetReadOnly: (() => void) | undefined;
  onSetStatus: (() => void) | undefined;
  onDispose: (() => void) | undefined;
  onSubscribe: (() => void) | undefined;
  onUnsubscribe: (() => void) | undefined;
  private listener: ((nextHtml: string) => void) | null = null;
  private lastListener: ((nextHtml: string) => void) | null = null;

  constructor(lifecycle: string[]) {
    this.lifecycle = lifecycle;
  }

  onChange(listener: (nextHtml: string) => void): () => void {
    this.listener = listener;
    this.lastListener = listener;
    this.lifecycle.push("editor:subscribe");
    this.onSubscribe?.();
    return () => {
      this.unsubscribeCount += 1;
      this.lifecycle.push("editor:unsubscribe");
      this.listener = null;
      this.onUnsubscribe?.();
      if (this.unsubscribeError) {
        throw this.unsubscribeError;
      }
    };
  }

  emit(nextHtml: string): void {
    this.listener?.(nextHtml);
  }

  emitStale(nextHtml: string): void {
    this.lastListener?.(nextHtml);
  }

  setHtml(nextHtml: string): void {
    this.html.push(nextHtml);
    this.onSetHtml?.();
  }

  getHtml(): string {
    return last(this.html) ?? "";
  }

  setReadOnly(readOnly: boolean): void {
    this.readOnlyValues.push(readOnly);
    this.onSetReadOnly?.();
  }

  setStatus(text: string): void {
    this.statuses.push(text);
    this.onSetStatus?.();
    if (this.statusError) {
      throw this.statusError;
    }
  }

  dispose(): void {
    this.disposeCount += 1;
    this.lifecycle.push("editor:dispose");
    this.listener = null;
    this.onDispose?.();
    if (this.disposeError) {
      throw this.disposeError;
    }
  }
}

class FakeReadOnlyView implements ReadOnlyView {
  readonly html: string[] = [];
  readonly statuses: string[] = [];
  readonly lifecycle: string[];
  disposeCount = 0;
  disposeError: unknown;
  onSetHtml: (() => void) | undefined;

  constructor(lifecycle: string[]) {
    this.lifecycle = lifecycle;
  }

  setHtml(nextHtml: string): void {
    this.html.push(nextHtml);
    this.onSetHtml?.();
  }

  setStatus(text: string): void {
    this.statuses.push(text);
  }

  dispose(): void {
    this.disposeCount += 1;
    this.lifecycle.push("readonly:dispose");
    if (this.disposeError) {
      throw this.disposeError;
    }
  }
}

class FakeSync implements SyncPort {
  readonly scheduled: string[] = [];
  readonly scheduledRequests: SyncRequestToken[] = [];
  readonly aligned: string[] = [];
  readonly lifecycle: string[];
  disposeCount = 0;
  flushCount = 0;
  flushError: unknown;
  flushPromise: Promise<void> | undefined;
  echoValues = new Set<string>();
  disposeError: unknown;
  onAlign: (() => void) | undefined;

  constructor(lifecycle: string[]) {
    this.lifecycle = lifecycle;
  }

  schedule(rawValue: string, request: SyncRequestToken): void {
    this.scheduled.push(rawValue);
    this.scheduledRequests.push(request);
  }

  async flush(): Promise<void> {
    this.flushCount += 1;
    if (this.flushError) {
      throw this.flushError;
    }
    await this.flushPromise;
  }

  alignToHost(rawValue: string): void {
    this.aligned.push(rawValue);
    this.onAlign?.();
  }

  isEcho(rawValue: string): boolean {
    return this.echoValues.has(rawValue);
  }

  dispose(): void {
    this.disposeCount += 1;
    this.lifecycle.push("sync:dispose");
    if (this.disposeError) {
      throw this.disposeError;
    }
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function loadedArgs(isReadOnly = false): IWorkItemLoadedArgs {
  return { id: 123, isNew: false, isReadOnly };
}

function changedArgs(changedFields: Record<string, unknown>): IWorkItemFieldChangedArgs {
  return { id: 123, changedFields } as IWorkItemFieldChangedArgs;
}

const changedEventArgs = { id: 123 } as IWorkItemChangedArgs;

function createFixture(
  options: {
    wit?: string;
    fieldValue?: string;
    typeError?: Error;
    fieldError?: Error;
    witResults?: Array<string | Promise<string>>;
    fieldResults?: Array<string | Promise<string>>;
    writePromise?: Promise<void>;
    writeHandler?: (value: string, writeNumber: number) => Promise<void>;
    realSync?: boolean;
    normalizer?: HtmlNormalizer;
    now?: () => Date;
  } = {}
) {
  const lifecycle: string[] = [];
  const root = document.createElement("div");
  const editor = new FakeEditor(lifecycle);
  const readOnlyView = new FakeReadOnlyView(lifecycle);
  const sync = new FakeSync(lifecycle);
  const writes: Array<{ fieldName: string; value: string }> = [];
  const reads: string[] = [];
  const changedFieldChecks: string[] = [];
  const telemetryMessages: unknown[][] = [];
  const telemetry = new TelemetryClient({
    extensionVersion: "9.8.7",
    hostType: "Services",
    now: () => new Date("2026-08-18T12:34:56.000Z"),
    info: (...values) => telemetryMessages.push(values)
  });
  let hostFieldValue = options.fieldValue ?? "<p>Hello</p>";
  let hostFieldError = options.fieldError;
  const witResults = [...(options.witResults ?? [])];
  const fieldResults = [...(options.fieldResults ?? [])];
  let writeNumber = 0;
  const bridge: WorkItemPort = {
    getWorkItemType: async () => {
      lifecycle.push("bridge:getWorkItemType");
      if (options.typeError) {
        throw options.typeError;
      }
      return await (witResults.shift() ?? options.wit ?? "SRS");
    },
    getFieldValue: async fieldName => {
      lifecycle.push(`bridge:getFieldValue:${fieldName}`);
      reads.push(fieldName);
      if (hostFieldError) {
        throw hostFieldError;
      }
      return await (fieldResults.shift() ?? hostFieldValue);
    },
    setFieldValue: async (fieldName, value) => {
      lifecycle.push(`bridge:setFieldValue:${fieldName}`);
      writes.push({ fieldName, value });
      writeNumber += 1;
      if (options.writeHandler) {
        await options.writeHandler(value, writeNumber);
        return;
      }
      await options.writePromise;
    },
    hasFieldChanged: (args, fieldName) => {
      changedFieldChecks.push(fieldName);
      return Object.prototype.hasOwnProperty.call(args.changedFields ?? {}, fieldName);
    }
  };
  let syncOptions: SyncEngineOptions | undefined;
  let editorOptions: RoosterHostOptions | undefined;
  const constructionHooks: {
    createEditor?: (options: RoosterHostOptions) => void;
    createReadOnlyView?: () => void;
    createSync?: (options: SyncEngineOptions) => void;
  } = {};
  const now = new Date("2026-08-18T15:16:17.000Z");
  now.toLocaleTimeString = () => "3:16:17 PM";
  const dependencies: ControllerDependencies = {
    bridge,
    normalizer: options.normalizer ?? new Sanitizer(),
    telemetry,
    createEditor: (_root, options) => {
      lifecycle.push("createEditor");
      editorOptions = options;
      constructionHooks.createEditor?.(options);
      return editor;
    },
    createReadOnlyView: _root => {
      lifecycle.push("createReadOnlyView");
      constructionHooks.createReadOnlyView?.();
      return readOnlyView;
    },
    createSync: syncEngineOptions => {
      lifecycle.push("createSync");
      syncOptions = syncEngineOptions;
      constructionHooks.createSync?.(syncEngineOptions);
      return options.realSync ? new SyncEngine(syncEngineOptions) : sync;
    },
    now: options.now ?? (() => now)
  };
  const config = getControlConfig({
    witInputs: {
      FieldName: "Custom.RoosterContent",
      EnabledWits: "SRS,HLD",
      DebounceMs: "25",
      EnableMarkdownAutoformat: "true",
      EnableCodeBlock: "false"
    }
  });
  const control = new RoosterDescriptionControl(root, config, dependencies);

  return {
    bridge,
    changedFieldChecks,
    config,
    constructionHooks,
    control,
    editor,
    getEditorOptions: () => editorOptions,
    getSyncOptions: () => syncOptions,
    lifecycle,
    readOnlyView,
    reads,
    root,
    setHostFieldError: (error: Error | undefined) => {
      hostFieldError = error;
    },
    setHostFieldValue: (value: string) => {
      hostFieldValue = value;
    },
    sync,
    telemetryClient: telemetry,
    telemetry: () =>
      telemetryMessages.map(values => JSON.parse(values[1] as string) as TelemetryPayload),
    writes
  };
}

type ControllerFixture = ReturnType<typeof createFixture>;

function currentSyncRequest(fixture: ControllerFixture): SyncRequestToken {
  const request = last(fixture.sync.scheduledRequests);
  if (!request) {
    throw new Error("Expected a scheduled sync request");
  }
  return request;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ReadOnlyView", () => {
  it("keeps normalized preview HTML separate from text-only status and disposes its shell", () => {
    const root = document.createElement("div");
    const view = createReadOnlyView(root);

    expect((root.querySelector(".rdx-status") as HTMLElement).hidden).toBe(true);

    view.setHtml('<div data-rdx-content-root=""><p>safe</p></div>');
    view.setStatus("<b>status is text</b>");

    expect(root.querySelector(".rdx-readonly")?.innerHTML).toBe(
      '<div data-rdx-content-root=""><p>safe</p></div>'
    );
    expect(root.querySelector(".rdx-status")?.textContent).toBe("<b>status is text</b>");
    expect(root.querySelector(".rdx-status")?.innerHTML).toBe("&lt;b&gt;status is text&lt;/b&gt;");
    expect((root.querySelector(".rdx-status") as HTMLElement).hidden).toBe(false);

    view.dispose();

    expect(root.childElementCount).toBe(0);
  });
});

describe("RoosterDescriptionControl onLoaded", () => {
  it("renders only the unsupported-WIT message without reading or constructing write capability", async () => {
    const fixture = createFixture({ wit: "Bug" });

    await fixture.control.onLoaded(loadedArgs());

    expect(fixture.root.textContent).toBe(
      'Rooster editor is not enabled for work item type "Bug".'
    );
    expect(fixture.reads).toEqual([]);
    expect(fixture.lifecycle).toEqual(["bridge:getWorkItemType"]);
    expect(fixture.writes).toEqual([]);
    expect(fixture.telemetry()).toEqual([
      {
        eventName: "control_loaded",
        timestamp: "2026-08-18T12:34:56.000Z",
        extensionVersion: "9.8.7",
        hostType: "Services",
        properties: {
          wit: "Bug",
          fieldName: "Custom.RoosterContent",
          isReadOnly: false,
          isEnabled: false
        }
      }
    ]);
  });

  it("renders one normalized configured-field preview for a read-only work item", async () => {
    const fixture = createFixture({ fieldValue: "<p>Hello</p>" });

    await fixture.control.onLoaded(loadedArgs(true));

    expect(fixture.reads).toEqual(["Custom.RoosterContent"]);
    expect(fixture.readOnlyView.html).toEqual([
      '<div data-rdx-content-root=""><p>Hello</p></div>'
    ]);
    expect(fixture.lifecycle).toEqual([
      "bridge:getWorkItemType",
      "bridge:getFieldValue:Custom.RoosterContent",
      "createReadOnlyView"
    ]);
    expect(fixture.editor.html).toEqual([]);
    expect(fixture.sync.aligned).toEqual([]);
    expect(fixture.writes).toEqual([]);
    expect(fixture.telemetry().map(payload => payload.eventName)).toEqual([
      "control_loaded",
      "readonly_rendered"
    ]);
  });

  it("loads normalized configured-field HTML into an aligned editable generation", async () => {
    const fixture = createFixture({ fieldValue: "<p>Hello</p>" });

    await fixture.control.onLoaded(loadedArgs());

    expect(fixture.reads).toEqual(["Custom.RoosterContent"]);
    expect(fixture.editor.html).toEqual([
      '<div data-rdx-content-root=""><p>Hello</p></div>'
    ]);
    expect(fixture.editor.readOnlyValues).toEqual([false]);
    expect(fixture.editor.statuses).toEqual([
      "Editing Custom.RoosterContent on SRS"
    ]);
    expect(fixture.sync.aligned).toEqual([
      '<div data-rdx-content-root=""><p>Hello</p></div>'
    ]);
    expect(fixture.lifecycle).toEqual([
      "bridge:getWorkItemType",
      "bridge:getFieldValue:Custom.RoosterContent",
      "createEditor",
      "createSync",
      "editor:subscribe"
    ]);
    expect(fixture.getEditorOptions()).toMatchObject({
      enableMarkdownAutoformat: true,
      enableCodeBlock: false
    });
    expect(fixture.getSyncOptions()?.debounceMs).toBe(25);
  });

  it("normalizes an empty configured field before mounting the editor", async () => {
    const fixture = createFixture({ fieldValue: "" });

    await fixture.control.onLoaded(loadedArgs());

    expect(fixture.editor.html).toEqual(['<div data-rdx-content-root=""></div>']);
    expect(fixture.sync.aligned).toEqual(['<div data-rdx-content-root=""></div>']);
  });

  it.each([
    ["work item type", { typeError: new Error("type\nfailed") }],
    ["initial field", { fieldError: new Error("field\nfailed") }]
  ])("contains an initial %s read failure as a post-bootstrap fatal message", async (_label, options) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fixture = createFixture(options);

    await fixture.control.onLoaded(loadedArgs());

    const message = "typeError" in options && options.typeError ? "typefailed" : "fieldfailed";
    expect(fixture.root.textContent).toBe(
      `Failed to initialize Rooster Description control: ${message}`
    );
    expect(fixture.editor.html).toEqual([]);
    expect(fixture.readOnlyView.html).toEqual([]);
    expect(fixture.sync.aligned).toEqual([]);
    expect(fixture.writes).toEqual([]);
    expect(warn).toHaveBeenCalledWith("[rdx-control] initial_read_failed");
  });
});

describe("RoosterDescriptionControl event coordination", () => {
  it("filters non-target changes with the injected bridge before any host read", async () => {
    const fixture = createFixture();
    await fixture.control.onLoaded(loadedArgs());
    fixture.setHostFieldValue("<p>must not be read</p>");

    await fixture.control.onFieldChanged(changedArgs({ "System.Description": "changed" }));

    expect(fixture.changedFieldChecks).toEqual(["Custom.RoosterContent"]);
    expect(fixture.reads).toEqual(["Custom.RoosterContent"]);
    expect(fixture.editor.html).toEqual([
      '<div data-rdx-content-root=""><p>Hello</p></div>'
    ]);
  });

  it("keeps a nested newer target event ahead of the outer target filter invocation", async () => {
    const newer = deferred<string>();
    const older = deferred<string>();
    const fixture = createFixture({
      fieldResults: ["<p>Initial</p>", newer.promise, older.promise]
    });
    await fixture.control.onLoaded(loadedArgs());
    let nestedRead: Promise<void> | undefined;
    let filterCount = 0;
    vi.spyOn(fixture.bridge, "hasFieldChanged").mockImplementation(() => {
      filterCount += 1;
      if (filterCount === 1) {
        nestedRead = fixture.control.onFieldChanged(
          changedArgs({ "Custom.RoosterContent": "newer" })
        );
      }
      return true;
    });

    const outerRead = fixture.control.onFieldChanged(
      changedArgs({ "Custom.RoosterContent": "older" })
    );
    if (!nestedRead) {
      throw new Error("Nested target event did not start");
    }
    newer.resolve("<p>Newest</p>");
    await nestedRead;
    older.resolve("<p>Stale</p>");
    await outerRead;

    const initial = '<div data-rdx-content-root=""><p>Initial</p></div>';
    const newest = '<div data-rdx-content-root=""><p>Newest</p></div>';
    expect(fixture.editor.html).toEqual([initial, newest]);
    expect(fixture.sync.aligned).toEqual([initial, newest]);
    expect(fixture.reads).toEqual([
      "Custom.RoosterContent",
      "Custom.RoosterContent",
      "Custom.RoosterContent"
    ]);
  });

  it("keeps a local edit reentered from field classification ahead of the external snapshot", async () => {
    const fixture = createFixture();
    await fixture.control.onLoaded(loadedArgs());
    fixture.setHostFieldValue("<p>External</p>");
    vi.spyOn(fixture.bridge, "hasFieldChanged").mockImplementation(() => {
      fixture.editor.emit("<p>Local during filter</p>");
      return true;
    });

    await fixture.control.onFieldChanged(
      changedArgs({ "Custom.RoosterContent": "external" })
    );

    expect(fixture.editor.html).toEqual([
      '<div data-rdx-content-root=""><p>Hello</p></div>'
    ]);
    expect(fixture.sync.aligned).toEqual([
      '<div data-rdx-content-root=""><p>Hello</p></div>'
    ]);
    expect(fixture.sync.scheduled).toEqual(["<p>Local during filter</p>"]);
    expect(last(fixture.editor.statuses)).toBe("Pending autosync...");
  });

  it("keeps a local edit reentered from external normalization ahead of that snapshot", async () => {
    const sanitizer = new Sanitizer();
    let fixture!: ControllerFixture;
    let normalizationCount = 0;
    const normalizer: HtmlNormalizer = {
      normalizeHtml: value => {
        normalizationCount += 1;
        if (normalizationCount === 2) {
          fixture.editor.emit("<p>Local during normalization</p>");
        }
        return sanitizer.normalizeHtml(value);
      }
    };
    fixture = createFixture({ normalizer });
    await fixture.control.onLoaded(loadedArgs());
    fixture.setHostFieldValue("<p>External</p>");

    await fixture.control.onFieldChanged(
      changedArgs({ "Custom.RoosterContent": "external" })
    );

    const initial = '<div data-rdx-content-root=""><p>Hello</p></div>';
    expect(fixture.editor.html).toEqual([initial]);
    expect(fixture.sync.aligned).toEqual([initial]);
    expect(fixture.sync.scheduled).toEqual(["<p>Local during normalization</p>"]);
    expect(last(fixture.editor.statuses)).toBe("Pending autosync...");
  });

  it("does not let a nested non-target event cancel the outer target read", async () => {
    const target = deferred<string>();
    const fixture = createFixture({
      fieldResults: ["<p>Initial</p>", target.promise]
    });
    await fixture.control.onLoaded(loadedArgs());
    const hasFieldChanged = fixture.bridge.hasFieldChanged.bind(fixture.bridge);
    let nestedRead: Promise<void> | undefined;
    let filterCount = 0;
    vi.spyOn(fixture.bridge, "hasFieldChanged").mockImplementation((args, fieldName) => {
      filterCount += 1;
      if (filterCount === 1) {
        nestedRead = fixture.control.onFieldChanged(
          changedArgs({ "System.Description": "not-target" })
        );
      }
      return hasFieldChanged(args, fieldName);
    });

    const outerRead = fixture.control.onFieldChanged(
      changedArgs({ "Custom.RoosterContent": "target" })
    );
    await nestedRead;
    target.resolve("<p>Target</p>");
    await outerRead;

    const initial = '<div data-rdx-content-root=""><p>Initial</p></div>';
    const applied = '<div data-rdx-content-root=""><p>Target</p></div>';
    expect(fixture.editor.html).toEqual([initial, applied]);
    expect(fixture.sync.aligned).toEqual([initial, applied]);
    expect(fixture.reads).toEqual([
      "Custom.RoosterContent",
      "Custom.RoosterContent"
    ]);
  });

  it("contains a throwing field filter as a barrier to older target work", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const older = deferred<string>();
    const fixture = createFixture({
      fieldResults: ["<p>Initial</p>", older.promise]
    });
    await fixture.control.onLoaded(loadedArgs());
    let filterCount = 0;
    vi.spyOn(fixture.bridge, "hasFieldChanged").mockImplementation(() => {
      filterCount += 1;
      if (filterCount === 2) {
        throw new Error("private filter details");
      }
      return true;
    });

    const olderRead = fixture.control.onFieldChanged(
      changedArgs({ "Custom.RoosterContent": "older" })
    );
    const barrierResult = await fixture.control
      .onFieldChanged(changedArgs({ "Custom.RoosterContent": "indeterminate" }))
      .then(
        () => undefined,
        error => error
      );
    older.resolve("<p>Stale</p>");
    await olderRead;

    const initial = '<div data-rdx-content-root=""><p>Initial</p></div>';
    expect(barrierResult).toBeUndefined();
    expect(fixture.editor.html).toEqual([initial]);
    expect(fixture.sync.aligned).toEqual([initial]);
    expect(warn).toHaveBeenCalledWith("[rdx-control] field_change_filter_failed");
    expect(warn.mock.calls.flat()).not.toContain("private filter details");
  });

  it.each(["last successful", "in flight"])(
    "ignores a configured-field %s echo without replacing editor state",
    async _echoKind => {
      const fixture = createFixture();
      await fixture.control.onLoaded(loadedArgs());
      const echo = '<div data-rdx-content-root=""><p>Echo</p></div>';
      fixture.setHostFieldValue("<p>Echo</p>");
      fixture.sync.echoValues.add(echo);

      await fixture.control.onFieldChanged(
        changedArgs({ "Custom.RoosterContent": "changed" })
      );

      expect(fixture.changedFieldChecks).toEqual(["Custom.RoosterContent"]);
      expect(fixture.editor.html).toEqual([
        '<div data-rdx-content-root=""><p>Hello</p></div>'
      ]);
      expect(fixture.sync.aligned).toEqual([
        '<div data-rdx-content-root=""><p>Hello</p></div>'
      ]);
    }
  );

  it("applies and aligns a real external configured-field change", async () => {
    const fixture = createFixture();
    await fixture.control.onLoaded(loadedArgs());
    fixture.setHostFieldValue("<p>External</p>");

    await fixture.control.onFieldChanged(changedArgs({ "Custom.RoosterContent": "changed" }));

    const external = '<div data-rdx-content-root=""><p>External</p></div>';
    expect(fixture.editor.html).toEqual([
      '<div data-rdx-content-root=""><p>Hello</p></div>',
      external
    ]);
    expect(fixture.sync.aligned).toEqual([
      '<div data-rdx-content-root=""><p>Hello</p></div>',
      external
    ]);
  });

  it("updates only the read-only preview for a configured-field change", async () => {
    const fixture = createFixture();
    await fixture.control.onLoaded(loadedArgs(true));
    fixture.setHostFieldValue("<p>Read-only update</p>");

    await fixture.control.onFieldChanged(changedArgs({ "Custom.RoosterContent": "changed" }));

    expect(fixture.readOnlyView.html).toEqual([
      '<div data-rdx-content-root=""><p>Hello</p></div>',
      '<div data-rdx-content-root=""><p>Read-only update</p></div>'
    ]);
    expect(fixture.editor.html).toEqual([]);
    expect(fixture.sync.aligned).toEqual([]);
  });

  it("schedules editor changes, writes only the immutable configured field, and reports success", async () => {
    const fixture = createFixture();
    await fixture.control.onLoaded(loadedArgs());

    fixture.editor.emit("<p>Next</p>");
    const request = currentSyncRequest(fixture);

    expect(fixture.sync.scheduled).toEqual(["<p>Next</p>"]);
    expect(last(fixture.editor.statuses)).toBe("Pending autosync...");

    const syncOptions = fixture.getSyncOptions();
    await syncOptions?.writeValue('<div data-rdx-content-root=""><p>Next</p></div>');
    expect(fixture.writes).toEqual([
      {
        fieldName: "Custom.RoosterContent",
        value: '<div data-rdx-content-root=""><p>Next</p></div>'
      }
    ]);
    expect(last(fixture.editor.statuses)).toBe("Pending autosync...");

    syncOptions?.onWriteSuccess?.(
      '<div data-rdx-content-root=""><p>Next</p></div>',
      request
    );
    expect(last(fixture.editor.statuses)).toBe("Autosynced");
    expect(fixture.telemetry().map(payload => payload.eventName)).toEqual([
      "control_loaded",
      "autosync_success"
    ]);
  });

  it("waits for flush before reporting an injected-clock save status", async () => {
    const fixture = createFixture();
    const flush = deferred<void>();
    fixture.sync.flushPromise = flush.promise;
    await fixture.control.onLoaded(loadedArgs());

    const saving = fixture.control.onSaved(changedEventArgs);
    await Promise.resolve();

    expect(fixture.sync.flushCount).toBe(1);
    expect(last(fixture.editor.statuses)).toBe("Editing Custom.RoosterContent on SRS");

    flush.resolve();
    await saving;

    expect(last(fixture.editor.statuses)).toBe("Synced (3:16:17 PM)");
  });

  it.each(["resolve", "reject"] as const)(
    "keeps a newer pending edit authoritative when an older save flush %ss",
    async outcome => {
      const fixture = createFixture();
      const flush = deferred<void>();
      fixture.sync.flushPromise = flush.promise;
      await fixture.control.onLoaded(loadedArgs());

      const saving = fixture.control.onSaved(changedEventArgs);
      await Promise.resolve();
      fixture.editor.emit("<p>Newer edit</p>");
      if (outcome === "reject") {
        flush.reject(new Error("old flush failed"));
      } else {
        flush.resolve();
      }
      await saving;

      expect(fixture.sync.scheduled).toEqual(["<p>Newer edit</p>"]);
      expect(last(fixture.editor.statuses)).toBe("Pending autosync...");
      expect(fixture.editor.statuses).not.toContain("Synced (3:16:17 PM)");
      expect(fixture.editor.statuses).not.toContain("Autosync failed: old flush failed");
    }
  );

  it("suppresses an older write success after a newer edit but accepts the latest value", async () => {
    const write = deferred<void>();
    const fixture = createFixture({ writePromise: write.promise });
    await fixture.control.onLoaded(loadedArgs());
    const syncOptions = fixture.getSyncOptions();
    const older = '<div data-rdx-content-root=""><p>Older</p></div>';
    const newer = '<div data-rdx-content-root=""><p>Newer</p></div>';

    fixture.editor.emit("<p>Older</p>");
    const olderRequest = currentSyncRequest(fixture);
    const olderWrite = syncOptions?.writeValue(older);
    fixture.editor.emit("<p>Newer</p>");
    const newerRequest = currentSyncRequest(fixture);
    write.resolve();
    await olderWrite;
    syncOptions?.onWriteSuccess?.(older, olderRequest);

    expect(last(fixture.editor.statuses)).toBe("Pending autosync...");
    expect(fixture.telemetry().map(payload => payload.eventName)).toEqual([
      "control_loaded"
    ]);

    await syncOptions?.writeValue(newer);
    syncOptions?.onWriteSuccess?.(newer, newerRequest);

    expect(last(fixture.editor.statuses)).toBe("Autosynced");
    expect(fixture.telemetry().map(payload => payload.eventName)).toEqual([
      "control_loaded",
      "autosync_success"
    ]);
  });

  it("does not stamp a delayed older write with a newer scheduled revision", async () => {
    const fixture = createFixture();
    await fixture.control.onLoaded(loadedArgs());
    const syncOptions = fixture.getSyncOptions();
    const older = '<div data-rdx-content-root=""><p>Older</p></div>';
    const newer = '<div data-rdx-content-root=""><p>Newer</p></div>';

    fixture.editor.emit("<p>Older</p>");
    const olderRequest = currentSyncRequest(fixture);
    fixture.editor.emit("<p>Newer</p>");
    const newerRequest = currentSyncRequest(fixture);
    await syncOptions?.writeValue(older);
    syncOptions?.onWriteSuccess?.(older, olderRequest);

    expect(fixture.sync.scheduled).toEqual(["<p>Older</p>", "<p>Newer</p>"]);
    expect(last(fixture.editor.statuses)).toBe("Pending autosync...");
    expect(fixture.telemetry().map(payload => payload.eventName)).toEqual([
      "control_loaded"
    ]);

    await syncOptions?.writeValue(newer);
    syncOptions?.onWriteSuccess?.(newer, newerRequest);
    expect(last(fixture.editor.statuses)).toBe("Autosynced");
  });

  it("settles a current A occurrence when an older in-flight A makes it redundant", async () => {
    vi.useFakeTimers();
    try {
      const firstWrite = deferred<void>();
      const fixture = createFixture({
        realSync: true,
        writeHandler: async (_value, writeNumber) => {
          if (writeNumber === 1) {
            await firstWrite.promise;
          }
        }
      });
      await fixture.control.onLoaded(loadedArgs());

      fixture.editor.emit("<p>A</p>");
      await vi.advanceTimersByTimeAsync(25);
      expect(fixture.writes.map(write => write.value)).toEqual([
        '<div data-rdx-content-root=""><p>A</p></div>'
      ]);

      fixture.editor.emit("<p>B</p>");
      fixture.editor.emit("<p>A</p>");
      firstWrite.resolve();
      await Promise.resolve();

      expect(last(fixture.editor.statuses)).toBe("Pending autosync...");
      expect(fixture.telemetry().map(payload => payload.eventName)).toEqual([
        "control_loaded"
      ]);

      await vi.advanceTimersByTimeAsync(25);

      expect(fixture.writes.map(write => write.value)).toEqual([
        '<div data-rdx-content-root=""><p>A</p></div>'
      ]);
      expect(last(fixture.editor.statuses)).toBe("Autosynced");
      expect(fixture.telemetry().map(payload => payload.eventName)).toEqual([
        "control_loaded",
        "autosync_success"
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["resolve", "resolve"],
    ["reject", "resolve"],
    ["resolve", "reject"],
    ["reject", "reject"]
  ] as const)(
    "keeps a queued old A %s from owning a later A that will %s across an intervening B",
    async (oldAOutcome, currentAOutcome) => {
      vi.useFakeTimers();
      try {
        const writes = Array.from({ length: 4 }, () => deferred<void>());
        const entered = Array.from({ length: 4 }, () => deferred<void>());
        const fixture = createFixture({
          realSync: true,
          writeHandler: async (_value, writeNumber) => {
            entered[writeNumber - 1]?.resolve();
            await writes[writeNumber - 1]?.promise;
          }
        });
        await fixture.control.onLoaded(loadedArgs());

        fixture.editor.emit("<p>X</p>");
        await vi.advanceTimersByTimeAsync(25);
        await entered[0]?.promise;
        fixture.editor.emit("<p>A</p>");
        await vi.advanceTimersByTimeAsync(25);
        fixture.editor.emit("<p>B</p>");
        await vi.advanceTimersByTimeAsync(25);
        fixture.editor.emit("<p>A</p>");
        await vi.advanceTimersByTimeAsync(25);

        writes[0]?.resolve();
        await entered[1]?.promise;
        if (oldAOutcome === "reject") {
          writes[1]?.reject(new Error("old A failed"));
        } else {
          writes[1]?.resolve();
        }
        await entered[2]?.promise;

        expect(last(fixture.editor.statuses)).toBe("Pending autosync...");
        expect(fixture.telemetry().map(payload => payload.eventName)).toEqual([
          "control_loaded"
        ]);

        writes[2]?.resolve();
        await entered[3]?.promise;
        if (currentAOutcome === "reject") {
          writes[3]?.reject(new Error("current A failed"));
        } else {
          writes[3]?.resolve();
        }
        await vi.advanceTimersByTimeAsync(0);

        expect(last(fixture.editor.statuses)).toBe(
          currentAOutcome === "reject"
            ? "Autosync failed: current A failed"
            : "Autosynced"
        );
        expect(fixture.telemetry().map(payload => payload.eventName)).toEqual([
          "control_loaded",
          currentAOutcome === "reject" ? "autosync_failure" : "autosync_success"
        ]);
      } finally {
        vi.useRealTimers();
      }
    }
  );

  it("lets save flush observe a latest A satisfied by an older in-flight A", async () => {
    vi.useFakeTimers();
    try {
      const firstWrite = deferred<void>();
      const fixture = createFixture({
        realSync: true,
        writeHandler: async (_value, writeNumber) => {
          if (writeNumber === 1) {
            await firstWrite.promise;
          }
        }
      });
      await fixture.control.onLoaded(loadedArgs());
      fixture.editor.emit("<p>A</p>");
      await vi.advanceTimersByTimeAsync(25);
      fixture.editor.emit("<p>B</p>");
      fixture.editor.emit("<p>A</p>");

      const saving = fixture.control.onSaved(changedEventArgs);
      firstWrite.resolve();
      await saving;

      expect(fixture.writes.map(write => write.value)).toEqual([
        '<div data-rdx-content-root=""><p>A</p></div>'
      ]);
      expect(fixture.telemetry().map(payload => payload.eventName)).toEqual([
        "control_loaded",
        "autosync_success"
      ]);
      expect(last(fixture.editor.statuses)).toBe("Synced (3:16:17 PM)");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps rapid full-document edits bounded to one controller occurrence and one debounce write", async () => {
    vi.useFakeTimers();
    try {
      const identityNormalizer: HtmlNormalizer = {
        normalizeHtml: value => value ?? ""
      };
      const fixture = createFixture({ realSync: true, normalizer: identityNormalizer });
      await fixture.control.onLoaded(loadedArgs());
      const suffix = "x".repeat(10_000);

      for (let index = 0; index < 500; index += 1) {
        fixture.editor.emit(`<p>${index}:${suffix}</p>`);
      }

      expect(
        Object.values(fixture.control).filter(value => value instanceof Map)
      ).toEqual([]);
      await vi.advanceTimersByTimeAsync(25);

      expect(fixture.writes).toHaveLength(1);
      expect(fixture.writes[0]?.value.startsWith("<p>499:")).toBe(true);
      expect(last(fixture.editor.statuses)).toBe("Autosynced");
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores an entered real-sync completion after external alignment", async () => {
    vi.useFakeTimers();
    try {
      const staleWrite = deferred<void>();
      const fixture = createFixture({
        realSync: true,
        writeHandler: async () => {
          await staleWrite.promise;
        }
      });
      await fixture.control.onLoaded(loadedArgs());
      fixture.editor.emit("<p>Local</p>");
      await vi.advanceTimersByTimeAsync(25);

      fixture.setHostFieldValue("<p>External</p>");
      await fixture.control.onRefreshed(changedEventArgs);
      staleWrite.resolve();
      await vi.advanceTimersByTimeAsync(0);

      expect(last(fixture.editor.statuses)).toBe("Reloaded from work item form");
      expect(fixture.telemetry().map(payload => payload.eventName)).toEqual([
        "control_loaded"
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops a real-sync debounce occurrence on unload", async () => {
    vi.useFakeTimers();
    try {
      const fixture = createFixture({ realSync: true });
      await fixture.control.onLoaded(loadedArgs());
      fixture.editor.emit("<p>Queued</p>");

      await fixture.control.onUnloaded(changedEventArgs);
      await vi.advanceTimersByTimeAsync(25);

      expect(fixture.writes).toEqual([]);
      expect(fixture.root.textContent).toBe("Work item unloaded.");
      expect(fixture.telemetry().map(payload => payload.eventName)).toEqual([
        "control_loaded"
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("suppresses an older write failure after external alignment but accepts a current failure", async () => {
    const fixture = createFixture();
    await fixture.control.onLoaded(loadedArgs());
    const syncOptions = fixture.getSyncOptions();
    const older = '<div data-rdx-content-root=""><p>Older</p></div>';
    const current = '<div data-rdx-content-root=""><p>Current</p></div>';

    fixture.editor.emit("<p>Older</p>");
    const olderRequest = currentSyncRequest(fixture);
    await syncOptions?.writeValue(older);
    fixture.setHostFieldValue("<p>External</p>");
    await fixture.control.onRefreshed(changedEventArgs);
    syncOptions?.onError?.(new Error("old write failed"), olderRequest);

    expect(last(fixture.editor.statuses)).toBe("Reloaded from work item form");
    expect(fixture.telemetry().map(payload => payload.eventName)).toEqual([
      "control_loaded"
    ]);

    fixture.editor.emit("<p>Current</p>");
    const currentRequest = currentSyncRequest(fixture);
    await syncOptions?.writeValue(current);
    const currentFailure = new Error("current write failed");
    currentFailure.name = "CurrentWriteError";
    syncOptions?.onError?.(currentFailure, currentRequest);

    expect(last(fixture.editor.statuses)).toBe(
      "Autosync failed: current write failed"
    );
    expect(last(fixture.telemetry())).toMatchObject({
      eventName: "autosync_failure",
      properties: {
        errorCode: "CurrentWriteError",
        fieldName: "Custom.RoosterContent",
        operation: "autosync",
        wit: "SRS"
      }
    });
  });

  it("retains a bounded autosync failure when save flush rejects", async () => {
    const fixture = createFixture();
    fixture.sync.flushError = new Error("write\nfailed");
    await fixture.control.onLoaded(loadedArgs());

    await fixture.control.onSaved(changedEventArgs);

    expect(last(fixture.editor.statuses)).toBe("Autosync failed: writefailed");
    expect(fixture.editor.statuses).not.toContain("Synced (3:16:17 PM)");
  });

  it("does not reclassify a successful flush when the injected clock throws", async () => {
    const fixture = createFixture({
      now: () => {
        throw new Error("clock observer failed");
      }
    });
    await fixture.control.onLoaded(loadedArgs());

    await expect(fixture.control.onSaved(changedEventArgs)).resolves.toBeUndefined();

    expect(fixture.sync.flushCount).toBe(1);
    expect(fixture.editor.statuses).not.toContain(
      "Autosync failed: clock observer failed"
    );
    expect(last(fixture.editor.statuses)).toBe("Editing Custom.RoosterContent on SRS");
  });

  it("does not reclassify a successful flush when time formatting throws", async () => {
    const date = new Date("2026-08-18T15:16:17.000Z");
    date.toLocaleTimeString = () => {
      throw new Error("time observer failed");
    };
    const fixture = createFixture({ now: () => date });
    await fixture.control.onLoaded(loadedArgs());

    await expect(fixture.control.onSaved(changedEventArgs)).resolves.toBeUndefined();

    expect(fixture.sync.flushCount).toBe(1);
    expect(fixture.editor.statuses).not.toContain(
      "Autosync failed: time observer failed"
    );
    expect(last(fixture.editor.statuses)).toBe("Editing Custom.RoosterContent on SRS");
  });

  it("contains a success-status observer fault without rendering persistence failure", async () => {
    const fixture = createFixture();
    await fixture.control.onLoaded(loadedArgs());
    fixture.editor.statusError = new Error("status observer failed");

    await expect(fixture.control.onSaved(changedEventArgs)).resolves.toBeUndefined();

    expect(fixture.sync.flushCount).toBe(1);
    expect(fixture.editor.statuses).toContain("Synced (3:16:17 PM)");
    expect(fixture.editor.statuses.some(status => status.startsWith("Autosync failed:"))).toBe(
      false
    );
  });

  it("contains a failure-status observer fault after a rejected flush", async () => {
    const fixture = createFixture();
    fixture.sync.flushError = new Error(`write\n${"x".repeat(250)}`);
    await fixture.control.onLoaded(loadedArgs());
    fixture.editor.statusError = new Error("status observer failed");

    await expect(fixture.control.onSaved(changedEventArgs)).resolves.toBeUndefined();

    expect(fixture.sync.flushCount).toBe(1);
    expect(last(fixture.editor.statuses)).toBe(`Autosync failed: write${"x".repeat(195)}`);
  });

  it.each([
    ["refresh", (control: RoosterDescriptionControl) => control.onRefreshed(changedEventArgs)],
    ["reset", (control: RoosterDescriptionControl) => control.onReset(changedEventArgs)]
  ])("normalizes, replaces, aligns, and reports a %s reload", async (_label, reload) => {
    const fixture = createFixture();
    await fixture.control.onLoaded(loadedArgs());
    fixture.setHostFieldValue("<p>Reloaded</p>");

    await reload(fixture.control);

    const reloaded = '<div data-rdx-content-root=""><p>Reloaded</p></div>';
    expect(last(fixture.editor.html)).toBe(reloaded);
    expect(last(fixture.sync.aligned)).toBe(reloaded);
    expect(last(fixture.editor.statuses)).toBe("Reloaded from work item form");
    expect(fixture.reads).toEqual([
      "Custom.RoosterContent",
      "Custom.RoosterContent"
    ]);
  });

  it.each([
    [
      "field change",
      (fixture: ControllerFixture) =>
        fixture.control.onFieldChanged(
          changedArgs({ "Custom.RoosterContent": "changed" })
        )
    ],
    [
      "refresh",
      (fixture: ControllerFixture) => fixture.control.onRefreshed(changedEventArgs)
    ]
  ])(
    "aligns and cancels local work before a mutating-then-throwing editor setHtml during %s",
    async (_label, reload) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const fixture = createFixture();
      await fixture.control.onLoaded(loadedArgs());
      fixture.editor.emit("<p>Pending local edit</p>");
      fixture.setHostFieldValue("<p>External</p>");
      fixture.editor.onSetHtml = () => {
        throw new Error("editor mutated before throwing");
      };

      try {
        await expect(reload(fixture)).resolves.toBeUndefined();
      } finally {
        warn.mockRestore();
      }

      const external = '<div data-rdx-content-root=""><p>External</p></div>';
      expect(last(fixture.editor.html)).toBe(external);
      expect(last(fixture.sync.aligned)).toBe(external);
    }
  );

  it("does not let a late external snapshot replace a newer pending local edit", async () => {
    const snapshot = deferred<string>();
    const fixture = createFixture({
      fieldResults: ["<p>Initial</p>", snapshot.promise]
    });
    await fixture.control.onLoaded(loadedArgs());

    const refreshing = fixture.control.onRefreshed(changedEventArgs);
    fixture.editor.emit("<p>Newer local edit</p>");
    snapshot.resolve("<p>Older external snapshot</p>");
    await refreshing;

    const initial = '<div data-rdx-content-root=""><p>Initial</p></div>';
    expect(fixture.editor.html).toEqual([initial]);
    expect(fixture.sync.aligned).toEqual([initial]);
    expect(fixture.sync.scheduled).toEqual(["<p>Newer local edit</p>"]);
    expect(last(fixture.editor.statuses)).toBe("Pending autosync...");
  });

  it("keeps a reentrant edit during external alignment ahead of reload status", async () => {
    const fixture = createFixture();
    await fixture.control.onLoaded(loadedArgs());
    fixture.setHostFieldValue("<p>External</p>");
    fixture.sync.onAlign = () => fixture.editor.emit("<p>Reentrant local edit</p>");

    await fixture.control.onReset(changedEventArgs);

    expect(fixture.sync.scheduled).toEqual(["<p>Reentrant local edit</p>"]);
    expect(last(fixture.editor.statuses)).toBe("Pending autosync...");
  });

  it("keeps a telemetry-reentrant edit ahead of an older autosync-success status", async () => {
    const fixture = createFixture();
    await fixture.control.onLoaded(loadedArgs());
    const syncOptions = fixture.getSyncOptions();
    const older = '<div data-rdx-content-root=""><p>Older</p></div>';
    const track = fixture.telemetryClient.track.bind(fixture.telemetryClient);
    vi.spyOn(fixture.telemetryClient, "track").mockImplementation((eventName, properties) => {
      track(eventName, properties);
      if (eventName === "autosync_success") {
        fixture.editor.emit("<p>Telemetry-reentrant edit</p>");
      }
    });
    fixture.editor.emit("<p>Older</p>");
    const olderRequest = currentSyncRequest(fixture);
    await syncOptions?.writeValue(older);

    syncOptions?.onWriteSuccess?.(older, olderRequest);

    expect(fixture.sync.scheduled).toEqual([
      "<p>Older</p>",
      "<p>Telemetry-reentrant edit</p>"
    ]);
    expect(last(fixture.editor.statuses)).toBe("Pending autosync...");
    expect(fixture.editor.statuses).not.toContain("Autosynced");
  });

  it("applies only the latest of two overlapping configured-field reads", async () => {
    const older = deferred<string>();
    const newer = deferred<string>();
    const fixture = createFixture({
      fieldResults: ["<p>Initial</p>", older.promise, newer.promise]
    });
    await fixture.control.onLoaded(loadedArgs());

    const olderRead = fixture.control.onFieldChanged(
      changedArgs({ "Custom.RoosterContent": "older" })
    );
    const newerRead = fixture.control.onFieldChanged(
      changedArgs({ "Custom.RoosterContent": "newer" })
    );
    newer.resolve("<p>Newest</p>");
    await newerRead;
    older.resolve("<p>Stale</p>");
    await olderRead;

    const initial = '<div data-rdx-content-root=""><p>Initial</p></div>';
    const newest = '<div data-rdx-content-root=""><p>Newest</p></div>';
    expect(fixture.editor.html).toEqual([initial, newest]);
    expect(fixture.sync.aligned).toEqual([initial, newest]);
  });

  it.each([
    [
      "refresh then field change",
      (control: RoosterDescriptionControl) => control.onRefreshed(changedEventArgs),
      (control: RoosterDescriptionControl) =>
        control.onFieldChanged(changedArgs({ "Custom.RoosterContent": "newer" })),
      "Editing Custom.RoosterContent on SRS"
    ],
    [
      "field change then reset",
      (control: RoosterDescriptionControl) =>
        control.onFieldChanged(changedArgs({ "Custom.RoosterContent": "older" })),
      (control: RoosterDescriptionControl) => control.onReset(changedEventArgs),
      "Reloaded from work item form"
    ],
    [
      "refresh then reset",
      (control: RoosterDescriptionControl) => control.onRefreshed(changedEventArgs),
      (control: RoosterDescriptionControl) => control.onReset(changedEventArgs),
      "Reloaded from work item form"
    ]
  ])(
    "shares one latest-read revision across overlapping %s requests",
    async (_label, startOlder, startNewer, expectedStatus) => {
      const older = deferred<string>();
      const newer = deferred<string>();
      const fixture = createFixture({
        fieldResults: ["<p>Initial</p>", older.promise, newer.promise]
      });
      await fixture.control.onLoaded(loadedArgs());

      const olderRead = startOlder(fixture.control);
      const newerRead = startNewer(fixture.control);
      newer.resolve("<p>Newest</p>");
      await newerRead;
      older.resolve("<p>Stale</p>");
      await olderRead;

      const initial = '<div data-rdx-content-root=""><p>Initial</p></div>';
      const newest = '<div data-rdx-content-root=""><p>Newest</p></div>';
      expect(fixture.editor.html).toEqual([initial, newest]);
      expect(fixture.sync.aligned).toEqual([initial, newest]);
      expect(last(fixture.editor.statuses)).toBe(expectedStatus);
    }
  );

  it("applies only the latest overlapping snapshot to a read-only view", async () => {
    const older = deferred<string>();
    const newer = deferred<string>();
    const fixture = createFixture({
      fieldResults: ["<p>Initial</p>", older.promise, newer.promise]
    });
    await fixture.control.onLoaded(loadedArgs(true));

    const olderRead = fixture.control.onFieldChanged(
      changedArgs({ "Custom.RoosterContent": "older" })
    );
    const newerRead = fixture.control.onReset(changedEventArgs);
    newer.resolve("<p>Newest</p>");
    await newerRead;
    older.resolve("<p>Stale</p>");
    await olderRead;

    expect(fixture.readOnlyView.html).toEqual([
      '<div data-rdx-content-root=""><p>Initial</p></div>',
      '<div data-rdx-content-root=""><p>Newest</p></div>'
    ]);
    expect(fixture.editor.html).toEqual([]);
    expect(fixture.sync.aligned).toEqual([]);
  });
});

describe("RoosterDescriptionControl lifecycle isolation and diagnostics", () => {
  it("ignores a synchronous feature callback before the editor factory returns", async () => {
    const fixture = createFixture();
    fixture.constructionHooks.createEditor = options => {
      options.onFeatureUsed?.("table");
    };

    await expect(fixture.control.onLoaded(loadedArgs())).resolves.toBeUndefined();

    expect(fixture.editor.html).toEqual([
      '<div data-rdx-content-root=""><p>Hello</p></div>'
    ]);
    expect(fixture.sync.aligned).toEqual([
      '<div data-rdx-content-root=""><p>Hello</p></div>'
    ]);
    expect(fixture.telemetry().map(payload => payload.eventName)).toEqual([
      "control_loaded"
    ]);
    expect(fixture.root.textContent).not.toContain(
      "Failed to initialize Rooster Description control:"
    );
  });

  it("stops a load when telemetry synchronously advances the lifecycle generation", async () => {
    const fixture = createFixture();
    vi.spyOn(fixture.telemetryClient, "track").mockImplementationOnce(() => {
      void fixture.control.onUnloaded(changedEventArgs);
    });

    await fixture.control.onLoaded(loadedArgs());

    expect(fixture.root.textContent).toBe("Work item unloaded.");
    expect(fixture.reads).toEqual([]);
    expect(fixture.lifecycle).toEqual(["bridge:getWorkItemType"]);
  });

  it("does not adopt a newer unload generation triggered during previous cleanup", async () => {
    const fixture = createFixture();
    await fixture.control.onLoaded(loadedArgs());
    fixture.editor.onUnsubscribe = () => {
      fixture.editor.onUnsubscribe = undefined;
      void fixture.control.onUnloaded(changedEventArgs);
    };

    await fixture.control.onLoaded(loadedArgs());

    expect(fixture.root.textContent).toBe("Work item unloaded.");
    expect(fixture.editor.html).toEqual([
      '<div data-rdx-content-root=""><p>Hello</p></div>'
    ]);
    expect(fixture.sync.aligned).toEqual([
      '<div data-rdx-content-root=""><p>Hello</p></div>'
    ]);
  });

  it("quiesces field-change handling before invoking external cleanup callbacks", async () => {
    const fixture = createFixture();
    await fixture.control.onLoaded(loadedArgs());
    fixture.editor.onUnsubscribe = () => {
      void fixture.control.onFieldChanged(
        changedArgs({ "Custom.RoosterContent": "changed during cleanup" })
      );
    };

    await fixture.control.onUnloaded(changedEventArgs);

    expect(fixture.changedFieldChecks).toEqual([]);
    expect(fixture.reads).toEqual(["Custom.RoosterContent"]);
  });

  it("does not let stale failure cleanup overwrite a newer unload lifecycle", async () => {
    const fixture = createFixture();
    fixture.constructionHooks.createSync = () => {
      throw new Error("sync construction failed");
    };
    fixture.editor.onDispose = () => {
      fixture.editor.onDispose = undefined;
      void fixture.control.onUnloaded(changedEventArgs);
    };

    await fixture.control.onLoaded(loadedArgs());

    expect(fixture.root.textContent).toBe("Work item unloaded.");
    expect(fixture.editor.disposeCount).toBe(1);
  });

  it("does not let hostile error inspection overwrite a newer unload lifecycle", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let fixture!: ControllerFixture;
    let unloaded = false;
    const hostileError = new Proxy(new Error("old load failed"), {
      get(target, property, receiver) {
        if (property === "message" && !unloaded) {
          unloaded = true;
          void fixture.control.onUnloaded(changedEventArgs);
        }
        return Reflect.get(target, property, receiver);
      }
    });
    fixture = createFixture({ fieldError: hostileError });

    try {
      await fixture.control.onLoaded(loadedArgs());
      expect(fixture.root.textContent).toBe("Work item unloaded.");
    } finally {
      warn.mockRestore();
    }
  });

  it.each([
    ["fatal", { fieldError: new Error("old load failed") }],
    ["unsupported", { wit: "Bug" }]
  ])(
    "reasserts a newer unload after a reentrant stale %s message sink returns",
    async (_messageKind, options) => {
      const fixture = createFixture(options);
      const replaceChildren = fixture.root.replaceChildren.bind(fixture.root);
      let isOuterCommit = true;
      let sinkDepth = 0;
      let maximumSinkDepth = 0;
      vi.spyOn(fixture.root, "replaceChildren").mockImplementation((...nodes) => {
        sinkDepth += 1;
        maximumSinkDepth = Math.max(maximumSinkDepth, sinkDepth);
        try {
          if (isOuterCommit) {
            isOuterCommit = false;
            void fixture.control.onUnloaded(changedEventArgs);
          }
          replaceChildren(...nodes);
        } finally {
          sinkDepth -= 1;
        }
      });

      await fixture.control.onLoaded(loadedArgs());

      expect(fixture.root.textContent).toBe("Work item unloaded.");
      expect(maximumSinkDepth).toBe(1);
    }
  );

  it("bounds every synchronous message sink and defers the exact retained newest request once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fixture = createFixture();
    const sink = vi.spyOn(fixture.root, "replaceChildren").mockImplementation(() => {
      throw new Error("persistent message sink failure");
    });

    const committedMessages: string[] = [];
    const reentrantLifecycles: Promise<void>[] = [];
    let textContentWrites = 0;
    let messageText = "";
    let queuedFailure = 0;
    const maxReentrantWrites = 100;
    fixture.bridge.getWorkItemType = () => {
      queuedFailure += 1;
      throw new Error(`newest queued failure ${queuedFailure}`);
    };

    Object.defineProperty(fixture.root, "textContent", {
      configurable: true,
      get() {
        return messageText;
      },
      set(value: string) {
        textContentWrites += 1;
        messageText = String(value);
        if (textContentWrites < maxReentrantWrites) {
          reentrantLifecycles.push(fixture.control.onLoaded(loadedArgs()));
        }
      }
    });

    try {
      const initialLifecycle = fixture.control.onUnloaded(changedEventArgs);

      const replaceChildrenAttempts = sink.mock.calls.length;
      expect(replaceChildrenAttempts).toBe(31);
      expect(textContentWrites).toBe(1);
      expect(replaceChildrenAttempts + textContentWrites).toBe(32);
      expect(queuedFailure).toBe(1);

      sink.mockImplementation((...nodes) => {
        committedMessages.push(
          nodes.map(node => typeof node === "string" ? node : node.textContent).join("")
        );
      });

      await initialLifecycle;
      await Promise.all(reentrantLifecycles);

      expect(committedMessages).toEqual([
        "Failed to initialize Rooster Description control: newest queued failure 1"
      ]);
    } finally {
      delete (fixture.root as unknown as { textContent?: string }).textContent;
      warn.mockRestore();
    }
  });

  it("lets a newer lifecycle supersede a retained request before its deferred retry", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fixture = createFixture();
    const sink = vi.spyOn(fixture.root, "replaceChildren").mockImplementation(() => {
      throw new Error("persistent message sink failure");
    });

    const committedMessages: string[] = [];
    let reentrantLifecycle: Promise<void> = Promise.resolve();
    let textContentWrites = 0;
    let queuedFailure = false;
    fixture.bridge.getWorkItemType = () => {
      queuedFailure = true;
      throw new Error("retained stale failure");
    };

    Object.defineProperty(fixture.root, "textContent", {
      configurable: true,
      get() {
        return "";
      },
      set() {
        textContentWrites += 1;
        if (!queuedFailure) {
          reentrantLifecycle = fixture.control.onLoaded(loadedArgs());
        }
      }
    });

    try {
      const initialLifecycle = fixture.control.onUnloaded(changedEventArgs);
      expect(sink.mock.calls.length + textContentWrites).toBe(32);

      sink.mockImplementation((...nodes) => {
        committedMessages.push(
          nodes.map(node => typeof node === "string" ? node : node.textContent).join("")
        );
      });
      const newerLifecycle = fixture.control.onUnloaded(changedEventArgs);

      await initialLifecycle;
      await reentrantLifecycle;
      await newerLifecycle;

      expect(committedMessages).toEqual(["Work item unloaded."]);
    } finally {
      delete (fixture.root as unknown as { textContent?: string }).textContent;
      warn.mockRestore();
    }
  });

  it("transfers the queued retry to a newer request that also exhausts its synchronous budget", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fixture = createFixture();
    const sink = vi.spyOn(fixture.root, "replaceChildren").mockImplementation(() => {
      throw new Error("persistent message sink failure");
    });

    const committedMessages: string[] = [];
    let fallbackWrites = 0;
    let failureNumber = 0;
    fixture.bridge.getWorkItemType = () => {
      failureNumber += 1;
      throw new Error(`retained failure ${failureNumber}`);
    };

    Object.defineProperty(fixture.root, "textContent", {
      configurable: true,
      get() {
        return "";
      },
      set() {
        fallbackWrites += 1;
        throw new Error("persistent fallback sink failure");
      }
    });

    try {
      const olderLifecycle = fixture.control.onLoaded(loadedArgs());
      expect(sink.mock.calls.length + fallbackWrites).toBe(32);

      const newerLifecycle = fixture.control.onLoaded(loadedArgs());
      expect(sink.mock.calls.length + fallbackWrites).toBe(64);

      sink.mockImplementation((...nodes) => {
        committedMessages.push(
          nodes.map(node => typeof node === "string" ? node : node.textContent).join("")
        );
      });

      await olderLifecycle;
      await newerLifecycle;

      expect(committedMessages).toEqual([
        "Failed to initialize Rooster Description control: retained failure 2"
      ]);
    } finally {
      delete (fixture.root as unknown as { textContent?: string }).textContent;
      warn.mockRestore();
    }
  });

  it("does not recursively defer a persistently failing retained message", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fixture = createFixture();
    const sink = vi.spyOn(fixture.root, "replaceChildren").mockImplementation(() => {
      throw new Error("persistent message sink failure");
    });

    let textContentWrites = 0;
    Object.defineProperty(fixture.root, "textContent", {
      configurable: true,
      get() {
        return "";
      },
      set() {
        textContentWrites += 1;
        throw new Error("persistent fallback sink failure");
      }
    });

    try {
      const lifecycle = fixture.control.onUnloaded(changedEventArgs);
      expect(sink.mock.calls.length + textContentWrites).toBe(32);

      await lifecycle;
      await Promise.resolve();
      const attemptsAfterDeferredRetry = sink.mock.calls.length + textContentWrites;
      expect(attemptsAfterDeferredRetry).toBe(64);

      await Promise.resolve();
      await Promise.resolve();
      expect(sink.mock.calls.length + textContentWrites).toBe(attemptsAfterDeferredRetry);
    } finally {
      delete (fixture.root as unknown as { textContent?: string }).textContent;
      warn.mockRestore();
    }
  });

  it.each([
    ["fatal", (fixture: ControllerFixture) => fixture.control.onLoaded(loadedArgs()), true],
    ["unsupported", (fixture: ControllerFixture) => fixture.control.onLoaded(loadedArgs()), false],
    ["unload", (fixture: ControllerFixture) => fixture.control.onUnloaded(changedEventArgs), false]
  ])(
    "contains a throwing %s message sink without rejecting its lifecycle callback",
    async (_messageKind, invoke, isFatal) => {
      const fixture = createFixture(
        isFatal
          ? { fieldError: new Error("old load failed") }
          : _messageKind === "unsupported"
            ? { wit: "Bug" }
            : {}
      );
      if (_messageKind === "unload") {
        await fixture.control.onLoaded(loadedArgs());
      }
      vi.spyOn(fixture.root, "replaceChildren").mockImplementationOnce(() => {
        throw new Error("DOM message sink failed");
      });

      await expect(invoke(fixture)).resolves.toBeUndefined();

      expect(fixture.root.textContent).toBe(
        isFatal
          ? "Failed to initialize Rooster Description control: old load failed"
          : _messageKind === "unsupported"
            ? 'Rooster editor is not enabled for work item type "Bug".'
            : "Work item unloaded."
      );

      await fixture.control.onUnloaded(changedEventArgs);
      expect(fixture.root.textContent).toBe("Work item unloaded.");

      if (_messageKind === "unload") {
        expect(fixture.editor.disposeCount).toBe(1);
        expect(fixture.sync.disposeCount).toBe(1);
      }
    }
  );

  it("retries the current lifecycle message after a transient replaceChildren fault", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fixture = createFixture();
    await fixture.control.onLoaded(loadedArgs());
    const replaceChildren = fixture.root.replaceChildren.bind(fixture.root);
    const sink = vi
      .spyOn(fixture.root, "replaceChildren")
      .mockImplementationOnce(() => {
        throw new Error("transient DOM message sink failure");
      })
      .mockImplementation((...nodes) => replaceChildren(...nodes));

    try {
      await fixture.control.onUnloaded(changedEventArgs);
    } finally {
      warn.mockRestore();
    }

    expect(fixture.root.textContent).toBe("Work item unloaded.");
    expect(sink).toHaveBeenCalledTimes(2);
  });

  it("falls back without dropping the current lifecycle message at the retry cap", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fixture = createFixture();
    await fixture.control.onLoaded(loadedArgs());
    const sink = vi.spyOn(fixture.root, "replaceChildren").mockImplementation(() => {
      throw new Error("persistent DOM message sink failure");
    });

    try {
      await fixture.control.onUnloaded(changedEventArgs);
    } finally {
      warn.mockRestore();
    }

    expect(sink).toHaveBeenCalledTimes(31);
    expect(fixture.root.textContent).toBe("Work item unloaded.");
  });

  it("does not report a stale save failure after error inspection unloads the control", async () => {
    const fixture = createFixture();
    await fixture.control.onLoaded(loadedArgs());
    let unloaded = false;
    fixture.sync.flushError = new Proxy(new Error("old save failed"), {
      get(target, property, receiver) {
        if (property === "message" && !unloaded) {
          unloaded = true;
          void fixture.control.onUnloaded(changedEventArgs);
        }
        return Reflect.get(target, property, receiver);
      }
    });

    await fixture.control.onSaved(changedEventArgs);

    expect(fixture.root.textContent).toBe("Work item unloaded.");
    expect(fixture.editor.statuses).toEqual([
      "Editing Custom.RoosterContent on SRS"
    ]);
  });

  it.each(["message", "name"] as const)(
    "suppresses stale autosync failure effects when %s inspection unloads the control",
    async propertyName => {
      const fixture = createFixture();
      await fixture.control.onLoaded(loadedArgs());
      let unloaded = false;
      const hostileError = new Proxy(new Error("old autosync failed"), {
        get(target, property, receiver) {
          if (property === propertyName && !unloaded) {
            unloaded = true;
            void fixture.control.onUnloaded(changedEventArgs);
          }
          return Reflect.get(target, property, receiver);
        }
      });

      fixture.editor.emit("<p>Pending failure</p>");
      fixture.getSyncOptions()?.onError?.(hostileError, currentSyncRequest(fixture));

      expect(fixture.root.textContent).toBe("Work item unloaded.");
      expect(fixture.telemetry().map(payload => payload.eventName)).toEqual([
        "control_loaded"
      ]);
      expect(fixture.editor.statuses).toEqual([
        "Editing Custom.RoosterContent on SRS",
        "Pending autosync..."
      ]);
    }
  );

  it("does not start a stale host read when field filtering advances the generation", async () => {
    const fixture = createFixture();
    await fixture.control.onLoaded(loadedArgs());
    vi.spyOn(fixture.bridge, "hasFieldChanged").mockImplementation(() => {
      void fixture.control.onUnloaded(changedEventArgs);
      return true;
    });

    await fixture.control.onFieldChanged(
      changedArgs({ "Custom.RoosterContent": "changed" })
    );

    expect(fixture.root.textContent).toBe("Work item unloaded.");
    expect(fixture.reads).toEqual(["Custom.RoosterContent"]);
  });

  it("keeps a synchronous subscription callback inert until acquisition commits", async () => {
    const fixture = createFixture();
    fixture.editor.onSubscribe = () => {
      fixture.editor.emit("<p>Premature</p>");
    };

    await fixture.control.onLoaded(loadedArgs());

    expect(fixture.sync.scheduled).toEqual([]);
    expect(fixture.editor.statuses).toEqual([
      "Editing Custom.RoosterContent on SRS"
    ]);

    fixture.editor.emit("<p>Committed</p>");
    expect(fixture.sync.scheduled).toEqual(["<p>Committed</p>"]);
    expect(last(fixture.editor.statuses)).toBe("Pending autosync...");
  });

  it.each([false, true])(
    "finishes a reentrant pending subscription teardown in unsubscribe-first order (throw=%s)",
    async unsubscribeThrows => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const fixture = createFixture();
      if (unsubscribeThrows) {
        fixture.editor.unsubscribeError = new Error("unsubscribe failed");
      }
      fixture.editor.onSubscribe = () => {
        fixture.editor.emit("<p>Premature</p>");
        void fixture.control.onUnloaded(changedEventArgs);
      };

      await expect(fixture.control.onLoaded(loadedArgs())).resolves.toBeUndefined();

      const subscribeIndex = fixture.lifecycle.lastIndexOf("editor:subscribe");
      expect(fixture.lifecycle.slice(subscribeIndex)).toEqual([
        "editor:subscribe",
        "editor:unsubscribe",
        "sync:dispose",
        "editor:dispose"
      ]);
      expect(fixture.sync.scheduled).toEqual([]);
      expect(fixture.editor.unsubscribeCount).toBe(1);
      expect(fixture.sync.disposeCount).toBe(1);
      expect(fixture.editor.disposeCount).toBe(1);
      expect(fixture.root.textContent).toBe("Work item unloaded.");

      await fixture.control.onUnloaded(changedEventArgs);
      expect(fixture.editor.unsubscribeCount).toBe(1);
      expect(fixture.sync.disposeCount).toBe(1);
      expect(fixture.editor.disposeCount).toBe(1);
      if (unsubscribeThrows) {
        expect(warn).toHaveBeenCalledWith("[rdx-control] unsubscribe_failed");
      }
    }
  );

  it.each(["throw", "missing handle"] as const)(
    "cleans staged sync and editor ownership when subscription acquisition ends with %s",
    async failureMode => {
      const fixture = createFixture();
      if (failureMode === "throw") {
        fixture.editor.onSubscribe = () => {
          throw new Error("subscription failed");
        };
      } else {
        const onChange = fixture.editor.onChange.bind(fixture.editor);
        vi.spyOn(fixture.editor, "onChange").mockImplementation(listener => {
          onChange(listener);
          return undefined as unknown as () => void;
        });
      }

      await expect(fixture.control.onLoaded(loadedArgs())).resolves.toBeUndefined();

      expect(fixture.editor.unsubscribeCount).toBe(0);
      expect(fixture.sync.disposeCount).toBe(1);
      expect(fixture.editor.disposeCount).toBe(1);
      expect(fixture.lifecycle.slice(-2)).toEqual([
        "sync:dispose",
        "editor:dispose"
      ]);
      expect(fixture.root.textContent).toContain(
        "Failed to initialize Rooster Description control:"
      );
    }
  );

  it.each([
    [
      "editor factory",
      (fixture: ControllerFixture) => {
        fixture.constructionHooks.createEditor = () => {
          void fixture.control.onUnloaded(changedEventArgs);
        };
      },
      0,
      0
    ],
    [
      "initial editor HTML",
      (fixture: ControllerFixture) => {
        fixture.editor.onSetHtml = () => {
          void fixture.control.onUnloaded(changedEventArgs);
        };
      },
      0,
      0
    ],
    [
      "read-only toggle",
      (fixture: ControllerFixture) => {
        fixture.editor.onSetReadOnly = () => {
          void fixture.control.onUnloaded(changedEventArgs);
        };
      },
      0,
      0
    ],
    [
      "initial status",
      (fixture: ControllerFixture) => {
        fixture.editor.onSetStatus = () => {
          void fixture.control.onUnloaded(changedEventArgs);
        };
      },
      0,
      0
    ],
    [
      "sync factory",
      (fixture: ControllerFixture) => {
        fixture.constructionHooks.createSync = () => {
          void fixture.control.onUnloaded(changedEventArgs);
        };
      },
      1,
      0
    ],
    [
      "initial sync alignment",
      (fixture: ControllerFixture) => {
        fixture.sync.onAlign = () => {
          void fixture.control.onUnloaded(changedEventArgs);
        };
      },
      1,
      0
    ],
    [
      "host subscription",
      (fixture: ControllerFixture) => {
        fixture.editor.onSubscribe = () => {
          void fixture.control.onUnloaded(changedEventArgs);
        };
      },
      1,
      1
    ]
  ])(
    "rolls back exactly once when generation changes during %s ownership",
    async (_stage, configure, expectedSyncDisposals, expectedUnsubscribes) => {
      const fixture = createFixture();
      configure(fixture);

      await expect(fixture.control.onLoaded(loadedArgs())).resolves.toBeUndefined();

      expect(fixture.root.textContent).toBe("Work item unloaded.");
      expect(fixture.editor.disposeCount).toBe(1);
      expect(fixture.sync.disposeCount).toBe(expectedSyncDisposals);
      expect(fixture.editor.unsubscribeCount).toBe(expectedUnsubscribes);
      expect(fixture.sync.scheduled).toEqual([]);

      await fixture.control.onUnloaded(changedEventArgs);
      expect(fixture.editor.disposeCount).toBe(1);
      expect(fixture.sync.disposeCount).toBe(expectedSyncDisposals);
      expect(fixture.editor.unsubscribeCount).toBe(expectedUnsubscribes);
    }
  );

  it.each([
    [
      "read-only factory",
      (fixture: ControllerFixture) => {
        fixture.constructionHooks.createReadOnlyView = () => {
          void fixture.control.onUnloaded(changedEventArgs);
        };
      }
    ],
    [
      "read-only HTML",
      (fixture: ControllerFixture) => {
        fixture.readOnlyView.onSetHtml = () => {
          void fixture.control.onUnloaded(changedEventArgs);
        };
      }
    ]
  ])("rolls back exactly once when generation changes during %s ownership", async (_stage, configure) => {
    const fixture = createFixture();
    configure(fixture);

    await expect(fixture.control.onLoaded(loadedArgs(true))).resolves.toBeUndefined();

    expect(fixture.root.textContent).toBe("Work item unloaded.");
    expect(fixture.readOnlyView.disposeCount).toBe(1);
    expect(fixture.telemetry().map(payload => payload.eventName)).toEqual([
      "control_loaded"
    ]);

    await fixture.control.onUnloaded(changedEventArgs);
    expect(fixture.readOnlyView.disposeCount).toBe(1);
  });

  it("contains control-loaded telemetry failure without turning a valid load fatal", async () => {
    const fixture = createFixture();
    vi.spyOn(fixture.telemetryClient, "track").mockImplementationOnce(() => {
      throw new Error("telemetry observer failed");
    });

    await expect(fixture.control.onLoaded(loadedArgs())).resolves.toBeUndefined();

    expect(fixture.editor.html).toEqual([
      '<div data-rdx-content-root=""><p>Hello</p></div>'
    ]);
    expect(fixture.sync.aligned).toEqual([
      '<div data-rdx-content-root=""><p>Hello</p></div>'
    ]);
    expect(fixture.editor.disposeCount).toBe(0);
    expect(fixture.root.textContent).not.toContain(
      "Failed to initialize Rooster Description control:"
    );
  });

  it("contains read-only telemetry failure without disposing a valid preview", async () => {
    const fixture = createFixture();
    vi.spyOn(fixture.telemetryClient, "track")
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw new Error("telemetry observer failed");
      });

    await expect(fixture.control.onLoaded(loadedArgs(true))).resolves.toBeUndefined();

    expect(fixture.readOnlyView.html).toEqual([
      '<div data-rdx-content-root=""><p>Hello</p></div>'
    ]);
    expect(fixture.readOnlyView.disposeCount).toBe(0);
    expect(fixture.root.textContent).not.toContain(
      "Failed to initialize Rooster Description control:"
    );
  });

  it("contains feature telemetry failure at the editor callback boundary", async () => {
    const fixture = createFixture();
    await fixture.control.onLoaded(loadedArgs());
    vi.spyOn(fixture.telemetryClient, "trackFeature").mockImplementation(() => {
      throw new Error("feature observer failed");
    });

    expect(() => fixture.getEditorOptions()?.onFeatureUsed?.("table")).not.toThrow();
    fixture.editor.emit("<p>still editable</p>");
    expect(fixture.sync.scheduled).toEqual(["<p>still editable</p>"]);
  });

  it("attempts success and failure statuses even when autosync telemetry throws", async () => {
    const fixture = createFixture();
    await fixture.control.onLoaded(loadedArgs());
    vi.spyOn(fixture.telemetryClient, "track").mockImplementation(() => {
      throw new Error("telemetry observer failed");
    });

    fixture.editor.emit("<p>success</p>");
    const successRequest = currentSyncRequest(fixture);
    expect(() =>
      fixture.getSyncOptions()?.onWriteSuccess?.("<p>success</p>", successRequest)
    ).not.toThrow();
    expect(last(fixture.editor.statuses)).toBe("Autosynced");
    fixture.editor.emit("<p>failure</p>");
    const failureRequest = currentSyncRequest(fixture);
    expect(() =>
      fixture.getSyncOptions()?.onError?.(new Error("write failed"), failureRequest)
    ).not.toThrow();
    expect(last(fixture.editor.statuses)).toBe("Autosync failed: write failed");
  });

  it("contains status faults throughout a valid editable load and change", async () => {
    const fixture = createFixture();
    fixture.editor.statusError = new Error("status observer failed");

    await expect(fixture.control.onLoaded(loadedArgs())).resolves.toBeUndefined();
    expect(fixture.editor.disposeCount).toBe(0);
    expect(fixture.sync.aligned).toEqual([
      '<div data-rdx-content-root=""><p>Hello</p></div>'
    ]);

    expect(() => fixture.editor.emit("<p>Next</p>")).not.toThrow();
    expect(fixture.sync.scheduled).toEqual(["<p>Next</p>"]);
    expect(fixture.editor.statuses).toEqual([
      "Editing Custom.RoosterContent on SRS",
      "Pending autosync..."
    ]);
  });

  it("does not misreport a reload when only its status sink throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fixture = createFixture();
    await fixture.control.onLoaded(loadedArgs());
    fixture.editor.statusError = new Error("status observer failed");
    fixture.setHostFieldValue("<p>Reloaded</p>");

    await expect(fixture.control.onRefreshed(changedEventArgs)).resolves.toBeUndefined();

    expect(last(fixture.editor.html)).toBe(
      '<div data-rdx-content-root=""><p>Reloaded</p></div>'
    );
    expect(last(fixture.sync.aligned)).toBe(
      '<div data-rdx-content-root=""><p>Reloaded</p></div>'
    );
    expect(warn).not.toHaveBeenCalledWith("[rdx-control] refresh_read_failed");
  });

  it("contains status faults in autosync callbacks without skipping either callback", async () => {
    const fixture = createFixture();
    await fixture.control.onLoaded(loadedArgs());
    fixture.editor.statusError = new Error("status observer failed");

    fixture.editor.emit("<p>success</p>");
    const successRequest = currentSyncRequest(fixture);
    expect(() =>
      fixture.getSyncOptions()?.onWriteSuccess?.("<p>success</p>", successRequest)
    ).not.toThrow();
    fixture.editor.emit("<p>failure</p>");
    const failureRequest = currentSyncRequest(fixture);
    expect(() =>
      fixture.getSyncOptions()?.onError?.(new Error("write failed"), failureRequest)
    ).not.toThrow();

    expect(fixture.editor.statuses).toContain("Autosynced");
    expect(last(fixture.editor.statuses)).toBe("Autosync failed: write failed");
  });

  it("attempts every editable disposer in order even when disposal and logging throw", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {
      throw new Error("logger observer failed");
    });
    const fixture = createFixture();
    await fixture.control.onLoaded(loadedArgs());
    fixture.editor.unsubscribeError = new Error("unsubscribe failed");
    fixture.sync.disposeError = new Error("sync dispose failed");
    fixture.editor.disposeError = new Error("editor dispose failed");

    await expect(fixture.control.onUnloaded(changedEventArgs)).resolves.toBeUndefined();

    expect(fixture.lifecycle.slice(-3)).toEqual([
      "editor:unsubscribe",
      "sync:dispose",
      "editor:dispose"
    ]);
    expect(fixture.editor.unsubscribeCount).toBe(1);
    expect(fixture.sync.disposeCount).toBe(1);
    expect(fixture.editor.disposeCount).toBe(1);
    expect(fixture.root.textContent).toBe("Work item unloaded.");
  });

  it("attempts read-only disposal once even when disposal and logging throw", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {
      throw new Error("logger observer failed");
    });
    const fixture = createFixture();
    await fixture.control.onLoaded(loadedArgs(true));
    fixture.readOnlyView.disposeError = new Error("readonly dispose failed");

    await expect(fixture.control.onUnloaded(changedEventArgs)).resolves.toBeUndefined();

    expect(fixture.readOnlyView.disposeCount).toBe(1);
    expect(last(fixture.lifecycle)).toBe("readonly:dispose");
    expect(fixture.root.textContent).toBe("Work item unloaded.");
  });

  it("contains a throwing diagnostic logger on initial and later read failures", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {
      throw new Error("logger observer failed");
    });
    const initialFailure = createFixture({ fieldError: new Error("initial read failed") });

    await expect(initialFailure.control.onLoaded(loadedArgs())).resolves.toBeUndefined();
    expect(initialFailure.root.textContent).toBe(
      "Failed to initialize Rooster Description control: initial read failed"
    );

    const laterFailure = createFixture();
    await laterFailure.control.onLoaded(loadedArgs());
    laterFailure.setHostFieldError(new Error("later read failed"));
    await expect(laterFailure.control.onReset(changedEventArgs)).resolves.toBeUndefined();
    expect(laterFailure.editor.html).toEqual([
      '<div data-rdx-content-root=""><p>Hello</p></div>'
    ]);
  });

  it("unsubscribes before disposing sync and editor exactly once, blocks stale enqueue, and resets state", async () => {
    const fixture = createFixture();
    await fixture.control.onLoaded(loadedArgs());
    fixture.editor.emit("<p>Queued</p>");
    const scheduledBeforeUnload = [...fixture.sync.scheduled];

    await fixture.control.onUnloaded(changedEventArgs);

    expect(fixture.lifecycle.slice(-3)).toEqual([
      "editor:unsubscribe",
      "sync:dispose",
      "editor:dispose"
    ]);
    expect(fixture.editor.unsubscribeCount).toBe(1);
    expect(fixture.sync.disposeCount).toBe(1);
    expect(fixture.editor.disposeCount).toBe(1);
    expect(fixture.root.textContent).toBe("Work item unloaded.");

    fixture.editor.emitStale("<p>Stale enqueue</p>");
    await fixture.control.onFieldChanged(
      changedArgs({ "Custom.RoosterContent": "changed" })
    );
    expect(fixture.sync.scheduled).toEqual(scheduledBeforeUnload);
    expect(fixture.changedFieldChecks).toEqual([]);

    await fixture.control.onUnloaded(changedEventArgs);
    expect(fixture.editor.unsubscribeCount).toBe(1);
    expect(fixture.sync.disposeCount).toBe(1);
    expect(fixture.editor.disposeCount).toBe(1);
  });

  it("disposes an independently owned read-only view once", async () => {
    const fixture = createFixture();
    await fixture.control.onLoaded(loadedArgs(true));

    await fixture.control.onUnloaded(changedEventArgs);
    await fixture.control.onUnloaded(changedEventArgs);

    expect(fixture.readOnlyView.disposeCount).toBe(1);
    expect(last(fixture.lifecycle)).toBe("readonly:dispose");
    expect(fixture.root.textContent).toBe("Work item unloaded.");
  });

  it("suppresses an older onLoaded completion after a newer load owns the generation", async () => {
    const firstType = deferred<string>();
    const fixture = createFixture({ witResults: [firstType.promise, "SRS"] });

    const staleLoad = fixture.control.onLoaded(loadedArgs());
    await Promise.resolve();
    await fixture.control.onLoaded(loadedArgs());
    firstType.resolve("SRS");
    await staleLoad;

    expect(fixture.lifecycle.filter(entry => entry === "createEditor")).toHaveLength(1);
    expect(fixture.reads).toEqual(["Custom.RoosterContent"]);
    expect(fixture.telemetry().map(payload => payload.eventName)).toEqual(["control_loaded"]);
    expect(fixture.editor.html).toEqual([
      '<div data-rdx-content-root=""><p>Hello</p></div>'
    ]);
  });

  it("suppresses a configured-field read completion after unload", async () => {
    const changedRead = deferred<string>();
    const fixture = createFixture({
      fieldResults: ["<p>Hello</p>", changedRead.promise]
    });
    await fixture.control.onLoaded(loadedArgs());

    const staleChange = fixture.control.onFieldChanged(
      changedArgs({ "Custom.RoosterContent": "changed" })
    );
    await Promise.resolve();
    await fixture.control.onUnloaded(changedEventArgs);
    changedRead.resolve("<p>Late</p>");
    await staleChange;

    expect(fixture.root.textContent).toBe("Work item unloaded.");
    expect(fixture.editor.html).toEqual([
      '<div data-rdx-content-root=""><p>Hello</p></div>'
    ]);
    expect(fixture.sync.aligned).toEqual([
      '<div data-rdx-content-root=""><p>Hello</p></div>'
    ]);
  });

  it("documents an entered host write as non-cancellable while suppressing stale callbacks", async () => {
    const enteredWrite = deferred<void>();
    const fixture = createFixture({ writePromise: enteredWrite.promise });
    await fixture.control.onLoaded(loadedArgs());
    const syncOptions = fixture.getSyncOptions();

    fixture.editor.emit("<p>Entered</p>");
    const enteredRequest = currentSyncRequest(fixture);

    const writing = syncOptions?.writeValue(
      '<div data-rdx-content-root=""><p>Entered</p></div>'
    );
    await Promise.resolve();
    expect(fixture.writes).toEqual([
      {
        fieldName: "Custom.RoosterContent",
        value: '<div data-rdx-content-root=""><p>Entered</p></div>'
      }
    ]);

    await fixture.control.onUnloaded(changedEventArgs);
    enteredWrite.resolve();
    await writing;
    syncOptions?.onWriteSuccess?.(
      '<div data-rdx-content-root=""><p>Entered</p></div>',
      enteredRequest
    );
    syncOptions?.onError?.(new Error("late failure"), enteredRequest);

    expect(fixture.root.textContent).toBe("Work item unloaded.");
    expect(fixture.telemetry().map(payload => payload.eventName)).toEqual(["control_loaded"]);
    expect(fixture.editor.statuses).toEqual([
      "Editing Custom.RoosterContent on SRS",
      "Pending autosync..."
    ]);
  });

  it("loads cleanly again after unload without duplicate active listeners", async () => {
    const fixture = createFixture();
    await fixture.control.onLoaded(loadedArgs());
    await fixture.control.onUnloaded(changedEventArgs);
    fixture.setHostFieldValue("<p>Second load</p>");

    await fixture.control.onLoaded(loadedArgs());
    fixture.editor.emit("<p>Second edit</p>");

    expect(fixture.lifecycle.filter(entry => entry === "editor:subscribe")).toHaveLength(2);
    expect(fixture.lifecycle.filter(entry => entry === "createSync")).toHaveLength(2);
    expect(last(fixture.sync.scheduled)).toBe("<p>Second edit</p>");
    expect(last(fixture.editor.html)).toBe(
      '<div data-rdx-content-root=""><p>Second load</p></div>'
    );
  });

  it.each([
    [
      "field change",
      "field_change_read_failed",
      (control: RoosterDescriptionControl) =>
        control.onFieldChanged(changedArgs({ "Custom.RoosterContent": "changed" }))
    ],
    [
      "refresh",
      "refresh_read_failed",
      (control: RoosterDescriptionControl) => control.onRefreshed(changedEventArgs)
    ],
    [
      "reset",
      "reset_read_failed",
      (control: RoosterDescriptionControl) => control.onReset(changedEventArgs)
    ]
  ])("preserves the last valid UI on a later %s read failure", async (_label, code, read) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fixture = createFixture();
    await fixture.control.onLoaded(loadedArgs());
    fixture.setHostFieldError(new Error("SECRET\nread failure"));

    await expect(read(fixture.control)).resolves.toBeUndefined();

    expect(fixture.editor.html).toEqual([
      '<div data-rdx-content-root=""><p>Hello</p></div>'
    ]);
    expect(fixture.sync.aligned).toEqual([
      '<div data-rdx-content-root=""><p>Hello</p></div>'
    ]);
    expect(last(fixture.editor.statuses)).toBe("Editing Custom.RoosterContent on SRS");
    expect(warn).toHaveBeenCalledWith(`[rdx-control] ${code}`);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("SECRET");
  });

  it("emits only the exact seven telemetry event names with controlled content-free properties", async () => {
    const editable = createFixture();
    await editable.control.onLoaded(loadedArgs());
    editable.getEditorOptions()?.onFeatureUsed?.("table");
    editable.getEditorOptions()?.onFeatureUsed?.("markdown");
    editable.getEditorOptions()?.onFeatureUsed?.("codeblock");
    editable.editor.emit("<p>success</p>");
    editable.getSyncOptions()?.onWriteSuccess?.(
      "<p>SECRET success content</p>",
      currentSyncRequest(editable)
    );
    const failure = new Error("<p>SECRET failure content</p>");
    failure.name = "TimeoutError";
    editable.editor.emit("<p>failure</p>");
    editable.getSyncOptions()?.onError?.(failure, currentSyncRequest(editable));

    const readOnly = createFixture();
    await readOnly.control.onLoaded(loadedArgs(true));
    const payloads = [...editable.telemetry(), ...readOnly.telemetry()];

    expect(payloads.map(payload => payload.eventName).sort()).toEqual(
      [
        "control_loaded",
        "autosync_success",
        "autosync_failure",
        "readonly_rendered",
        "feature_used_table",
        "feature_used_markdown",
        "feature_used_codeblock",
        "control_loaded"
      ].sort()
    );
    expect(payloads.find(payload => payload.eventName === "autosync_failure")?.properties).toEqual(
      {
        wit: "SRS",
        fieldName: "Custom.RoosterContent",
        errorCode: "TimeoutError",
        operation: "autosync"
      }
    );
    expect(JSON.stringify(payloads)).not.toContain("SECRET");
    expect(JSON.stringify(payloads)).not.toContain("<p>");
  });

  it("bounds autosync status errors and uses a stable fallback for unknown failures", async () => {
    const fixture = createFixture();
    await fixture.control.onLoaded(loadedArgs());

    fixture.editor.emit("<p>first failure</p>");
    fixture.getSyncOptions()?.onError?.(
      new Error(`bad\n${"x".repeat(250)}`),
      currentSyncRequest(fixture)
    );
    expect(last(fixture.editor.statuses)).toBe(`Autosync failed: bad${"x".repeat(197)}`);

    fixture.editor.emit("<p>second failure</p>");
    fixture.getSyncOptions()?.onError?.(
      { message: "<p>SECRET</p>" },
      currentSyncRequest(fixture)
    );
    expect(last(fixture.editor.statuses)).toBe("Autosync failed: Unable to save changes");
  });

  it("uses fallback autosync diagnostics when an Error proxy rejects inspection", async () => {
    const fixture = createFixture();
    await fixture.control.onLoaded(loadedArgs());
    const hostileError = new Proxy(new Error("SECRET"), {
      get: (target, property, receiver) => {
        if (property === "message" || property === "name") {
          throw new Error("error inspection failed");
        }
        return Reflect.get(target, property, receiver);
      }
    });

    fixture.editor.emit("<p>failure</p>");
    expect(() =>
      fixture.getSyncOptions()?.onError?.(hostileError, currentSyncRequest(fixture))
    ).not.toThrow();
    expect(last(fixture.editor.statuses)).toBe("Autosync failed: Unable to save changes");
    expect(last(fixture.telemetry())?.properties).toMatchObject({
      errorCode: "UnknownError",
      operation: "autosync"
    });
    expect(JSON.stringify(fixture.telemetry())).not.toContain("SECRET");
  });
});
