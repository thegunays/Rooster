import * as SDK from "azure-devops-extension-sdk";
import type {
  IWorkItemChangedArgs,
  IWorkItemFieldChangedArgs,
  IWorkItemLoadedArgs,
  IWorkItemNotificationListener
} from "azure-devops-extension-api/WorkItemTracking";

import { Sanitizer } from "../bridge/Sanitizer";
import { SyncEngine } from "../bridge/SyncEngine";
import { WorkItemBridge } from "../bridge/WorkItemBridge";
import { getControlConfig, type ControlConfig } from "../config/defaults";
import { TelemetryClient, type TelemetryClientOptions } from "../telemetry/TelemetryClient";
import {
  RoosterDescriptionControl,
  type WorkItemPort
} from "./RoosterDescriptionControl";
import { createReadOnlyView } from "./ReadOnlyView";
import { RoosterHost } from "./RoosterHost";
import { formatPublicError } from "./errorFormatting";

const INITIALIZATION_FAILURE_PREFIX = "Failed to initialize Rooster Description control: ";
const INITIALIZATION_FALLBACK = "Initialization failed";
const EXPLICIT_FIELD_ERROR = "FieldName must be explicitly configured.";

export interface BootstrapSdkAdapter {
  init(options: { loaded: false; applyTheme: true }): Promise<void> | void;
  ready(): Promise<void>;
  getConfiguration(): unknown;
  getHost(): { readonly isHosted?: boolean } | undefined;
  getExtensionContext(): { readonly version?: string } | undefined;
  getContributionId(): string;
  register(id: string, factory: () => object): PromiseLike<void> | void;
  resize(width: number, height: number): void;
  notifyLoadSucceeded(): Promise<void> | void;
  notifyLoadFailed(message: string): Promise<void> | void;
}

export interface BootstrapTelemetryMetadata
  extends Pick<TelemetryClientOptions, "extensionVersion" | "hostType"> {}

export interface BootstrapDependencies {
  readonly sdk: BootstrapSdkAdapter;
  readonly resolveRoot: () => HTMLElement | null;
  readonly createBridge: () => Promise<WorkItemPort>;
  readonly createTelemetry: (metadata: BootstrapTelemetryMetadata) => TelemetryClient;
  readonly createController: (
    root: HTMLElement,
    config: ControlConfig,
    bridge: WorkItemPort,
    telemetry: TelemetryClient
  ) => object;
}

function getHostType(host: { readonly isHosted?: boolean } | undefined) {
  if (typeof host?.isHosted !== "boolean") {
    return "Unknown" as const;
  }

  return host.isHosted ? ("Services" as const) : ("Server" as const);
}

export async function bootstrap(dependencies: BootstrapDependencies): Promise<void> {
  const { sdk } = dependencies;
  let root: HTMLElement | null = null;
  let rootResolutionCompleted = false;
  let successNotificationBegun = false;

  try {
    await sdk.init({ loaded: false, applyTheme: true });
    await sdk.ready();

    root = await dependencies.resolveRoot();
    rootResolutionCompleted = true;
    if (!root) {
      throw new Error("Missing root element #app");
    }

    const rawConfiguration = await sdk.getConfiguration();
    const host = await sdk.getHost();
    const extension = await sdk.getExtensionContext();
    const config = getControlConfig(rawConfiguration);

    if (!config.fieldNameWasExplicit) {
      throw new Error(EXPLICIT_FIELD_ERROR);
    }

    const bridge = await dependencies.createBridge();
    const telemetry = await dependencies.createTelemetry({
      extensionVersion: extension?.version ?? "unknown",
      hostType: getHostType(host)
    });
    const controller = await dependencies.createController(root, config, bridge, telemetry);
    const contributionId = await sdk.getContributionId();

    await sdk.register(contributionId, () => controller);
    successNotificationBegun = true;
    try {
      await sdk.notifyLoadSucceeded();
    } catch (notificationError) {
      warnBootstrap(
        "notify_load_succeeded_failed",
        notificationError,
        "Success notification failed"
      );
    }
  } catch (error) {
    if (successNotificationBegun) {
      return;
    }

    const message = formatPublicError(error, INITIALIZATION_FALLBACK);
    if (!rootResolutionCompleted) {
      try {
        root = await dependencies.resolveRoot();
      } catch {
        root = null;
      }
    }
    if (root) {
      try {
        root.textContent = `${INITIALIZATION_FAILURE_PREFIX}${message}`;
      } catch (renderError) {
        warnBootstrap("failure_render_failed", renderError, "Failure rendering failed");
      }
    }

    try {
      await sdk.notifyLoadFailed(message);
    } catch (notificationError) {
      warnBootstrap("notify_load_failed", notificationError, "Failure notification failed");
    }
  }
}

function warnBootstrap(operationCode: string, error: unknown, fallback: string): void {
  try {
    console.warn(`[rdx-bootstrap] ${operationCode}`, formatPublicError(error, fallback));
  } catch {
    // Host-provided diagnostics must not change bootstrap outcomes.
  }
}

class ResponsiveWorkItemControl implements IWorkItemNotificationListener {
  private lifecycleGeneration = 0;
  private active = false;
  private resizeListenerAttached = false;
  private resizeObserver: ResizeObserver | null = null;

  constructor(
    private readonly control: RoosterDescriptionControl,
    private readonly root: HTMLElement,
    private readonly requestParentResize: (width: number, height: number) => void
  ) {}

  onLoaded = async (args: IWorkItemLoadedArgs): Promise<void> => {
    const generation = ++this.lifecycleGeneration;
    this.stopResponsiveSizing();

    await this.control.onLoaded(args);
    if (generation !== this.lifecycleGeneration) {
      return;
    }

    this.startResponsiveSizing();
    this.requestParentResizeSafely();
  };

  onFieldChanged = async (args: IWorkItemFieldChangedArgs): Promise<void> => {
    await this.control.onFieldChanged(args);
  };

  onSaved = async (args: IWorkItemChangedArgs): Promise<void> => {
    await this.control.onSaved(args);
  };

  onRefreshed = async (args: IWorkItemChangedArgs): Promise<void> => {
    await this.control.onRefreshed(args);
  };

  onReset = async (args: IWorkItemChangedArgs): Promise<void> => {
    await this.control.onReset(args);
  };

  onUnloaded = async (args: IWorkItemChangedArgs): Promise<void> => {
    ++this.lifecycleGeneration;
    this.stopResponsiveSizing();
    await this.control.onUnloaded(args);
  };

  private readonly handleResponsiveResize = (): void => {
    if (this.active) {
      this.requestParentResizeSafely();
    }
  };

  private startResponsiveSizing(): void {
    this.active = true;

    try {
      window.addEventListener("resize", this.handleResponsiveResize);
      this.resizeListenerAttached = true;
    } catch {
      this.resizeListenerAttached = false;
    }

    if (typeof ResizeObserver !== "function") {
      return;
    }

    const observerGeneration = this.lifecycleGeneration;
    let observer: ResizeObserver | null = null;
    try {
      observer = new ResizeObserver(() => {
        if (this.active && observerGeneration === this.lifecycleGeneration) {
          this.requestParentResizeSafely();
        }
      });
      observer.observe(this.root);
      this.resizeObserver = observer;
    } catch {
      try {
        observer?.disconnect();
      } catch {
        // Responsive sizing is observational and cannot alter control loading.
      }
    }
  }

  private stopResponsiveSizing(): void {
    this.active = false;

    if (this.resizeListenerAttached) {
      this.resizeListenerAttached = false;
      try {
        window.removeEventListener("resize", this.handleResponsiveResize);
      } catch {
        // Responsive sizing is observational and cannot alter control unloading.
      }
    }

    const observer = this.resizeObserver;
    this.resizeObserver = null;
    try {
      observer?.disconnect();
    } catch {
      // Responsive sizing is observational and cannot alter control unloading.
    }
  }

  private requestParentResizeSafely(): void {
    try {
      const viewportWidth = window.innerWidth;
      const intrinsicHeight = this.root.scrollHeight;
      this.requestParentResize(viewportWidth, intrinsicHeight);
    } catch {
      // Layout measurement and host sizing failures cannot alter the control lifecycle.
    }
  }
}

export function createProductionBootstrapDependencies(): BootstrapDependencies {
  const sdk: BootstrapSdkAdapter = {
    init: options => SDK.init(options),
    ready: () => SDK.ready(),
    getConfiguration: () => SDK.getConfiguration(),
    getHost: () => SDK.getHost(),
    getExtensionContext: () => SDK.getExtensionContext(),
    getContributionId: () => SDK.getContributionId(),
    register: (id, factory) => SDK.register(id, factory),
    resize: (width, height) => SDK.resize(width, height),
    notifyLoadSucceeded: () => SDK.notifyLoadSucceeded(),
    notifyLoadFailed: message => SDK.notifyLoadFailed(message)
  };

  return {
    sdk,
    resolveRoot: () => document.getElementById("app"),
    createBridge: () => WorkItemBridge.create(),
    createTelemetry: metadata => new TelemetryClient(metadata),
    createController: (root, config, bridge, telemetry) => {
      const control = new RoosterDescriptionControl(root, config, {
        bridge,
        normalizer: new Sanitizer(),
        telemetry,
        createEditor: (editorRoot, options) => new RoosterHost(editorRoot, options),
        createReadOnlyView,
        createSync: options => new SyncEngine(options),
        now: () => new Date()
      });

      return new ResponsiveWorkItemControl(control, root, (width, height) =>
        sdk.resize(width, height)
      );
    }
  };
}
