import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IWorkItemFieldChangedArgs } from "azure-devops-extension-api/WorkItemTracking";
import type { WorkItemPort } from "../../src/control/RoosterDescriptionControl";

const productionSdk = vi.hoisted(() => ({
  init: vi.fn(),
  ready: vi.fn(),
  getConfiguration: vi.fn(),
  getHost: vi.fn(),
  getExtensionContext: vi.fn(),
  getService: vi.fn(),
  getContributionId: vi.fn(),
  register: vi.fn(),
  notifyLoadSucceeded: vi.fn(),
  notifyLoadFailed: vi.fn()
}));

vi.mock("azure-devops-extension-sdk", () => productionSdk);
vi.mock("azure-devops-extension-api/WorkItemTracking", () => ({
  WorkItemTrackingServiceIds: { WorkItemFormService: "work-item-form-service" }
}));

import {
  bootstrap,
  createProductionBootstrapDependencies,
  type BootstrapDependencies,
  type BootstrapSdkAdapter
} from "../../src/control/bootstrap";
import { TelemetryClient } from "../../src/telemetry/TelemetryClient";

function createBridge(): WorkItemPort {
  return {
    getFieldValue: vi.fn(async () => ""),
    setFieldValue: vi.fn(async () => undefined),
    getWorkItemType: vi.fn(async () => "SRS"),
    hasFieldChanged: vi.fn((_args: IWorkItemFieldChangedArgs, _fieldName: string) => false)
  };
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

type BootstrapRuntimePhase =
  | "resolveRoot"
  | "getConfiguration"
  | "getHost"
  | "getExtensionContext"
  | "createTelemetry"
  | "createController"
  | "getContributionId";

interface BootstrapFixtureOptions {
  root?: HTMLElement | null;
  configuration?: unknown;
  bridgeError?: Error;
  initError?: unknown;
  readyError?: unknown;
  resolveRootError?: unknown;
  registerError?: unknown;
  registerResult?: PromiseLike<void>;
  notifySuccessError?: unknown;
  notifySuccessResult?: Promise<void>;
  notifyFailureError?: unknown;
  runtimeTransforms?: Partial<
    Record<BootstrapRuntimePhase, (value: unknown) => unknown>
  >;
}

function transformRuntimeValue(
  options: BootstrapFixtureOptions,
  phase: BootstrapRuntimePhase,
  value: unknown
): unknown {
  const transform = options.runtimeTransforms?.[phase];
  return transform ? transform(value) : value;
}

function createFixture(options: BootstrapFixtureOptions = {}) {
  const calls: string[] = [];
  const root = options.root === undefined ? document.createElement("div") : options.root;
  const controller = { onLoaded: vi.fn() };
  const bridge = createBridge();
  const telemetry = new TelemetryClient({
    extensionVersion: "9.8.7",
    hostType: "Services",
    info: vi.fn()
  });
  let registeredController: object | undefined;
  const sdk: BootstrapSdkAdapter = {
    init: async initOptions => {
      calls.push(`init:${JSON.stringify(initOptions)}`);
      if (options.initError) {
        throw options.initError;
      }
    },
    ready: async () => {
      calls.push("ready");
      if (options.readyError) {
        throw options.readyError;
      }
    },
    getConfiguration: () => {
      calls.push("getConfiguration");
      const configuration = Object.prototype.hasOwnProperty.call(options, "configuration")
        ? options.configuration
        : {
            witInputs: {
              FieldName: "Custom.RoosterContent",
              EnabledWits: "SRS,HLD"
            }
          };
      return transformRuntimeValue(
        options,
        "getConfiguration",
        configuration
      );
    },
    getHost: () => {
      calls.push("getHost");
      return transformRuntimeValue(options, "getHost", { isHosted: true }) as {
        isHosted: boolean;
      };
    },
    getExtensionContext: () => {
      calls.push("getExtensionContext");
      return transformRuntimeValue(options, "getExtensionContext", {
        version: "9.8.7"
      }) as { version: string };
    },
    getContributionId: () => {
      calls.push("getContributionId");
      return transformRuntimeValue(
        options,
        "getContributionId",
        "rooster-description-control"
      ) as string;
    },
    register: (id, factory) => {
      calls.push(`register:${id}`);
      registeredController = factory();
      if (options.registerError) {
        throw options.registerError;
      }
      return options.registerResult;
    },
    notifyLoadSucceeded: () => {
      calls.push("notifyLoadSucceeded");
      if (options.notifySuccessError) {
        throw options.notifySuccessError;
      }
      return options.notifySuccessResult;
    },
    notifyLoadFailed: message => {
      calls.push(`notifyLoadFailed:${message}`);
      if (options.notifyFailureError) {
        throw options.notifyFailureError;
      }
    }
  };
  const dependencies: BootstrapDependencies = {
    sdk,
    resolveRoot: () => {
      calls.push("resolve:#app");
      if (options.resolveRootError) {
        throw options.resolveRootError;
      }
      return transformRuntimeValue(options, "resolveRoot", root) as HTMLElement | null;
    },
    createBridge: async () => {
      calls.push("createBridge");
      if (options.bridgeError) {
        throw options.bridgeError;
      }
      return bridge;
    },
    createTelemetry: metadata => {
      calls.push(`createTelemetry:${metadata.extensionVersion}:${metadata.hostType}`);
      return transformRuntimeValue(
        options,
        "createTelemetry",
        telemetry
      ) as TelemetryClient;
    },
    createController: (receivedRoot, config, receivedBridge, receivedTelemetry) => {
      calls.push(`createController:${config.fieldName}`);
      expect(receivedRoot).toBe(root);
      expect(receivedBridge).toBe(bridge);
      expect(receivedTelemetry).toBe(telemetry);
      expect(Object.isFrozen(config)).toBe(true);
      return transformRuntimeValue(
        options,
        "createController",
        controller
      ) as object;
    }
  };

  return {
    bridge,
    calls,
    controller,
    dependencies,
    getRegisteredController: () => registeredController,
    root,
    telemetry
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const runtimePhaseCases: ReadonlyArray<{
  phase: BootstrapRuntimePhase;
  phaseCall: string;
  nextCall: string;
}> = [
  { phase: "resolveRoot", phaseCall: "resolve:#app", nextCall: "getConfiguration" },
  { phase: "getConfiguration", phaseCall: "getConfiguration", nextCall: "getHost" },
  { phase: "getHost", phaseCall: "getHost", nextCall: "getExtensionContext" },
  {
    phase: "getExtensionContext",
    phaseCall: "getExtensionContext",
    nextCall: "createBridge"
  },
  {
    phase: "createTelemetry",
    phaseCall: "createTelemetry:9.8.7:Services",
    nextCall: "createController:Custom.RoosterContent"
  },
  {
    phase: "createController",
    phaseCall: "createController:Custom.RoosterContent",
    nextCall: "getContributionId"
  },
  {
    phase: "getContributionId",
    phaseCall: "getContributionId",
    nextCall: "register:rooster-description-control"
  }
];

function createRuntimeThenableTransform(
  getCalls: () => string[],
  marker: string,
  outcome: "resolve" | "reject",
  rejection?: unknown
): {
  transform: (value: unknown) => unknown;
  then: ReturnType<typeof vi.fn>;
} {
  const then = vi.fn(
    (
      value: unknown,
      resolve: (resolvedValue: unknown) => void,
      reject: (reason: unknown) => void
    ) => {
      getCalls().push(marker);
      if (outcome === "reject") {
        reject(rejection);
      } else {
        resolve(value);
      }
    }
  );

  return {
    transform: value => ({
      then: (
        resolve: (resolvedValue: unknown) => void,
        reject: (reason: unknown) => void
      ) => then(value, resolve, reject)
    }),
    then
  };
}

describe("bootstrap", () => {
  it("has no Azure SDK side effect when its testable module is imported", () => {
    expect(productionSdk.init).not.toHaveBeenCalled();
    expect(productionSdk.ready).not.toHaveBeenCalled();
    expect(productionSdk.getService).not.toHaveBeenCalled();
  });

  it("creates production dependencies lazily without touching the Azure SDK", () => {
    createProductionBootstrapDependencies();

    expect(productionSdk.init).not.toHaveBeenCalled();
    expect(productionSdk.ready).not.toHaveBeenCalled();
    expect(productionSdk.getConfiguration).not.toHaveBeenCalled();
    expect(productionSdk.getHost).not.toHaveBeenCalled();
    expect(productionSdk.getExtensionContext).not.toHaveBeenCalled();
    expect(productionSdk.getService).not.toHaveBeenCalled();
  });

  it("initializes, validates, composes, registers, and succeeds in the exact order", async () => {
    const fixture = createFixture();

    await bootstrap(fixture.dependencies);

    expect(fixture.calls).toEqual([
      'init:{"loaded":false,"applyTheme":true}',
      "ready",
      "resolve:#app",
      "getConfiguration",
      "getHost",
      "getExtensionContext",
      "createBridge",
      "createTelemetry:9.8.7:Services",
      "createController:Custom.RoosterContent",
      "getContributionId",
      "register:rooster-description-control",
      "notifyLoadSucceeded"
    ]);
    expect(fixture.getRegisteredController()).toBe(fixture.controller);
  });

  it.each(runtimePhaseCases)(
    "awaits a resolving runtime thenable from $phase before the next phase",
    async ({ phase, phaseCall, nextCall }) => {
      let calls: string[] = [];
      const marker = `await:${phase}`;
      const runtime = createRuntimeThenableTransform(
        () => calls,
        marker,
        "resolve"
      );
      const fixture = createFixture({
        runtimeTransforms: { [phase]: runtime.transform }
      });
      calls = fixture.calls;

      await bootstrap(fixture.dependencies);

      expect(runtime.then).toHaveBeenCalledTimes(1);
      expect(calls.slice(calls.indexOf(phaseCall), calls.indexOf(phaseCall) + 3)).toEqual([
        phaseCall,
        marker,
        nextCall
      ]);
      expect(calls[calls.length - 1]).toBe("notifyLoadSucceeded");
      expect(fixture.getRegisteredController()).toBe(fixture.controller);
    }
  );

  it.each(runtimePhaseCases)(
    "contains a rejecting runtime thenable from $phase with its original cause",
    async ({ phase }) => {
      let calls: string[] = [];
      const marker = `await:${phase}`;
      const failure = new Error(`${phase} async failed`);
      const runtime = createRuntimeThenableTransform(
        () => calls,
        marker,
        "reject",
        failure
      );
      const fixture = createFixture({
        runtimeTransforms: { [phase]: runtime.transform }
      });
      calls = fixture.calls;

      await expect(bootstrap(fixture.dependencies)).resolves.toBeUndefined();

      expect(runtime.then).toHaveBeenCalledTimes(phase === "resolveRoot" ? 2 : 1);
      expect(calls).toContain(`notifyLoadFailed:${phase} async failed`);
      expect(calls.some(call => call.startsWith("register:"))).toBe(false);
      expect(calls).not.toContain("notifyLoadSucceeded");
      if (phase === "resolveRoot") {
        expect(fixture.root?.textContent).toBe("");
      } else {
        expect(fixture.root?.textContent).toBe(
          `Failed to initialize Rooster Description control: ${phase} async failed`
        );
      }
    }
  );

  it("notifies failure exactly once when root rendering, notification, and logging throw", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {
      throw new Error("logger sink failed");
    });
    const fixture = createFixture({
      bridgeError: new Error("bridge failed"),
      notifyFailureError: new Error("notification sink failed")
    });
    if (!fixture.root) {
      throw new Error("Missing root fixture");
    }
    Object.defineProperty(fixture.root, "textContent", {
      configurable: true,
      set: () => {
        fixture.calls.push("renderFailure");
        throw new Error("root sink failed");
      }
    });

    await expect(bootstrap(fixture.dependencies)).resolves.toBeUndefined();

    expect(fixture.calls.filter(call => call === "renderFailure")).toHaveLength(1);
    expect(
      fixture.calls.filter(call => call === "notifyLoadFailed:bridge failed")
    ).toHaveLength(1);
    expect(fixture.calls).not.toContain("notifyLoadSucceeded");
  });

  it("fails safely for a missing root before reading configuration or requesting a bridge", async () => {
    const fixture = createFixture({ root: null });

    await bootstrap(fixture.dependencies);

    expect(fixture.calls).toEqual([
      'init:{"loaded":false,"applyTheme":true}',
      "ready",
      "resolve:#app",
      "notifyLoadFailed:Missing root element #app"
    ]);
  });

  it.each([
    ["missing", {}],
    ["blank", { witInputs: { FieldName: " \t\n " } }]
  ])(
    "rejects a %s raw FieldName after metadata capture and before bridge creation",
    async (_label, configuration) => {
      const fixture = createFixture({ configuration });

      await bootstrap(fixture.dependencies);

      expect(fixture.root?.textContent).toBe(
        "Failed to initialize Rooster Description control: FieldName must be explicitly configured."
      );
      expect(fixture.calls).toEqual([
        'init:{"loaded":false,"applyTheme":true}',
        "ready",
        "resolve:#app",
        "getConfiguration",
        "getHost",
        "getExtensionContext",
        "notifyLoadFailed:FieldName must be explicitly configured."
      ]);
    }
  );

  it.each([
    ["an inherited witInputs container", Object.create({
      witInputs: { FieldName: "System.Description" }
    })],
    ["an inherited FieldName", {
      witInputs: Object.create({ FieldName: "System.Description" })
    }],
    ["a duck-typed FieldName", {
      witInputs: { FieldName: { trim: () => "System.Description" } }
    }],
    ["a numeric FieldName", { witInputs: { FieldName: 42 } }],
    ["a boolean FieldName", { witInputs: { FieldName: true } }],
    ["a symbol FieldName", { witInputs: { FieldName: Symbol("System.Description") } }],
    ["a null FieldName", { witInputs: { FieldName: null } }],
    ["a null configuration", null],
    ["a scalar configuration", 17]
  ])("rejects %s before creating any configured-field capability", async (_label, configuration) => {
    const fixture = createFixture({ configuration });

    await bootstrap(fixture.dependencies);

    expect(fixture.root?.textContent).toBe(
      "Failed to initialize Rooster Description control: FieldName must be explicitly configured."
    );
    expect(fixture.calls).toEqual([
      'init:{"loaded":false,"applyTheme":true}',
      "ready",
      "resolve:#app",
      "getConfiguration",
      "getHost",
      "getExtensionContext",
      "notifyLoadFailed:FieldName must be explicitly configured."
    ]);
    expect(fixture.calls).not.toContain("createBridge");
    expect(fixture.calls).not.toContain("notifyLoadSucceeded");
    expect(fixture.calls.some(call => call.includes("System.Description"))).toBe(false);
  });

  it("rejects accessor capabilities without invoking either getter", async () => {
    const inputsGetter = vi.fn(() => ({ FieldName: "System.Description" }));
    const fieldGetter = vi.fn(() => "System.Description");
    const accessorInputs = Object.defineProperty({}, "witInputs", { get: inputsGetter });
    const accessorField = {
      witInputs: Object.defineProperty({}, "FieldName", { get: fieldGetter })
    };

    for (const configuration of [accessorInputs, accessorField]) {
      const fixture = createFixture({ configuration });

      await bootstrap(fixture.dependencies);

      expect(fixture.root?.textContent).toBe(
        "Failed to initialize Rooster Description control: FieldName must be explicitly configured."
      );
      expect(fixture.calls).not.toContain("createBridge");
      expect(fixture.calls).not.toContain("notifyLoadSucceeded");
      expect(fixture.calls.every(call => !call.startsWith("register:"))).toBe(true);
    }
    expect(inputsGetter).not.toHaveBeenCalled();
    expect(fieldGetter).not.toHaveBeenCalled();
  });

  it("bounds initialization failure text and never registers or reports success", async () => {
    const fixture = createFixture({ bridgeError: new Error(`private\n${"x".repeat(250)}`) });

    await bootstrap(fixture.dependencies);

    const bounded = `private${"x".repeat(193)}`;
    expect(fixture.root?.textContent).toBe(
      `Failed to initialize Rooster Description control: ${bounded}`
    );
    expect(fixture.calls[fixture.calls.length - 1]).toBe(`notifyLoadFailed:${bounded}`);
    expect(fixture.calls).not.toContain("notifyLoadSucceeded");
    expect(fixture.calls.every(call => !call.startsWith("register:"))).toBe(true);
  });

  it.each([
    ["init", { initError: new Error("<b>init failed</b>") }, false],
    ["ready", { readyError: new Error("<b>ready failed</b>") }, true]
  ])(
    "re-resolves the root and renders a text-only %s failure without entering later phases",
    async (_phase, options, reachedReady) => {
      const fixture = createFixture(options);

      await bootstrap(fixture.dependencies);

      const message = reachedReady ? "<b>ready failed</b>" : "<b>init failed</b>";
      expect(fixture.root?.textContent).toBe(
        `Failed to initialize Rooster Description control: ${message}`
      );
      expect(fixture.root?.innerHTML).toContain("&lt;b&gt;");
      expect(fixture.calls).toEqual([
        'init:{"loaded":false,"applyTheme":true}',
        ...(reachedReady ? ["ready"] : []),
        "resolve:#app",
        `notifyLoadFailed:${message}`
      ]);
      expect(fixture.calls).not.toContain("getConfiguration");
      expect(fixture.calls).not.toContain("createBridge");
      expect(fixture.calls).not.toContain("notifyLoadSucceeded");
    }
  );

  it("contains root-resolution failure while retrying resolution only for safe rendering", async () => {
    const fixture = createFixture({ resolveRootError: new Error("root lookup failed") });

    await expect(bootstrap(fixture.dependencies)).resolves.toBeUndefined();

    expect(fixture.calls).toEqual([
      'init:{"loaded":false,"applyTheme":true}',
      "ready",
      "resolve:#app",
      "resolve:#app",
      "notifyLoadFailed:root lookup failed"
    ]);
    expect(fixture.calls).not.toContain("getConfiguration");
    expect(fixture.calls).not.toContain("createBridge");
    expect(fixture.calls).not.toContain("notifyLoadSucceeded");
  });

  it("awaits a registration thenable before notifying load success", async () => {
    const registration = deferred<void>();
    const fixture = createFixture({ registerResult: registration.promise });
    let settled = false;

    const bootstrapping = bootstrap(fixture.dependencies).then(() => {
      settled = true;
    });
    await vi.waitFor(() => {
      expect(fixture.calls).toContain("register:rooster-description-control");
    });

    expect(fixture.calls).not.toContain("notifyLoadSucceeded");
    expect(settled).toBe(false);
    registration.resolve();
    await bootstrapping;
    expect(fixture.calls.slice(-2)).toEqual([
      "register:rooster-description-control",
      "notifyLoadSucceeded"
    ]);
  });

  it.each([
    ["synchronous throw", { registerError: new Error("register failed") }],
    [
      "rejected runtime thenable",
      {
        registerResult: {
          then: (_resolve: (value: void) => void, reject: (reason: unknown) => void) =>
            reject(new Error("register failed"))
        } as PromiseLike<void>
      }
    ]
  ])("reports a registration %s as a pre-success bootstrap failure", async (_label, options) => {
    const fixture = createFixture(options);

    await bootstrap(fixture.dependencies);

    expect(fixture.root?.textContent).toBe(
      "Failed to initialize Rooster Description control: register failed"
    );
    expect(fixture.calls.slice(-2)).toEqual([
      "register:rooster-description-control",
      "notifyLoadFailed:register failed"
    ]);
    expect(fixture.calls).not.toContain("notifyLoadSucceeded");
  });

  it("assimilates a successful load-notification thenable", async () => {
    const notification = deferred<void>();
    const fixture = createFixture({ notifySuccessResult: notification.promise });
    let settled = false;

    const bootstrapping = bootstrap(fixture.dependencies).then(() => {
      settled = true;
    });
    await vi.waitFor(() => {
      expect(fixture.calls).toContain("notifyLoadSucceeded");
    });
    expect(settled).toBe(false);

    notification.resolve();
    await bootstrapping;
    expect(fixture.calls.some(call => call.startsWith("notifyLoadFailed:"))).toBe(false);
  });

  it.each([
    ["synchronous throw", { notifySuccessError: new Error("success notification failed") }],
    [
      "rejected thenable",
      {
        notifySuccessResult: {
          then: (_resolve: (value: void) => void, reject: (reason: unknown) => void) =>
            reject(new Error("success notification failed"))
        } as unknown as Promise<void>
      }
    ]
  ])(
    "never emits a second failure notification after notifyLoadSucceeded begins with a %s",
    async (_label, options) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const fixture = createFixture(options);

      await expect(bootstrap(fixture.dependencies)).resolves.toBeUndefined();

      expect(fixture.calls.slice(-2)).toEqual([
        "register:rooster-description-control",
        "notifyLoadSucceeded"
      ]);
      expect(fixture.calls.some(call => call.startsWith("notifyLoadFailed:"))).toBe(false);
      expect(fixture.root?.textContent).toBe("");
      expect(warn).toHaveBeenCalledWith(
        "[rdx-bootstrap] notify_load_succeeded_failed",
        "success notification failed"
      );
    }
  );

  it("contains a throwing failure notification and diagnostic logger", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {
      throw new Error("logger observer failed");
    });
    const fixture = createFixture({
      bridgeError: new Error("bridge failed"),
      notifyFailureError: new Error("failure notification failed")
    });

    await expect(bootstrap(fixture.dependencies)).resolves.toBeUndefined();

    expect(fixture.root?.textContent).toBe(
      "Failed to initialize Rooster Description control: bridge failed"
    );
    expect(fixture.calls.slice(-2)).toEqual([
      "createBridge",
      "notifyLoadFailed:bridge failed"
    ]);
  });
});
