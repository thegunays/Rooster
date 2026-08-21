import type {
  IWorkItemChangedArgs,
  IWorkItemFieldChangedArgs,
  IWorkItemLoadedArgs,
  IWorkItemNotificationListener
} from "azure-devops-extension-api/WorkItemTracking";

import type { HtmlNormalizer } from "../bridge/Sanitizer";
import type { SyncEngineOptions, SyncRequestToken } from "../bridge/SyncEngine";
import { isEnabledWit, type ControlConfig } from "../config/defaults";
import type { TelemetryClient } from "../telemetry/TelemetryClient";
import type { ReadOnlyView } from "./ReadOnlyView";
import type { EditorHost, RoosterHostOptions } from "./RoosterHost";
import { formatPublicError } from "./errorFormatting";

const INITIALIZATION_FAILURE_PREFIX = "Failed to initialize Rooster Description control: ";
const INITIALIZATION_FALLBACK = "Unable to load work item content";
const AUTOSYNC_FALLBACK = "Unable to save changes";
const MAX_MESSAGE_RENDER_ATTEMPTS = 32;

type ActiveMode = "none" | "readonly" | "editable";
type PendingMessage = {
  readonly generation: number;
  readonly message: string;
};

export interface WorkItemPort {
  getFieldValue(fieldName: string): Promise<string>;
  setFieldValue(fieldName: string, value: string): Promise<void>;
  getWorkItemType(): Promise<string>;
  hasFieldChanged(args: IWorkItemFieldChangedArgs, fieldName: string): boolean;
}

export interface SyncPort {
  schedule(rawValue: string, request: SyncRequestToken): void;
  flush(): Promise<void>;
  alignToHost(rawValue: string): void;
  isEcho(rawValue: string): boolean;
  dispose(): void;
}

export interface ControllerDependencies {
  readonly bridge: WorkItemPort;
  readonly normalizer: HtmlNormalizer;
  readonly telemetry: TelemetryClient;
  readonly createEditor: (root: HTMLElement, options: RoosterHostOptions) => EditorHost;
  readonly createReadOnlyView: (root: HTMLElement) => ReadOnlyView;
  readonly createSync: (options: SyncEngineOptions) => SyncPort;
  readonly now: () => Date;
}

export class RoosterDescriptionControl implements IWorkItemNotificationListener {
  private generation = 0;
  private contentRequestOrdinal = 0;
  private latestContentRequestOrdinal = 0;
  private activeWit = "";
  private isReadOnly = false;
  private activeMode: ActiveMode = "none";
  private host: EditorHost | null = null;
  private readOnlyView: ReadOnlyView | null = null;
  private syncEngine: SyncPort | null = null;
  private disposeHostChange: (() => void) | null = null;
  private presentationRevision = 0;
  private latestSyncRequest: {
    readonly token: SyncRequestToken;
    readonly revision: number;
  } | null = null;
  private pendingMessage: PendingMessage | null = null;
  private isRenderingMessage = false;
  private scheduledMessageRetry: PendingMessage | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly config: ControlConfig,
    private readonly dependencies: ControllerDependencies
  ) {}

  onLoaded = async (workItemLoadedArgs: IWorkItemLoadedArgs): Promise<void> => {
    const generation = this.beginGeneration();
    if (!this.isCurrent(generation)) {
      return;
    }

    try {
      const workItemType = await this.dependencies.bridge.getWorkItemType();
      if (!this.isCurrent(generation)) {
        return;
      }

      this.activeWit = workItemType;
      this.isReadOnly = !!workItemLoadedArgs.isReadOnly;
      const isEnabled = isEnabledWit(this.config, this.activeWit);

      this.trackSafely("control_loaded", {
        wit: this.activeWit || "Unknown",
        fieldName: this.config.fieldName,
        isReadOnly: this.isReadOnly,
        isEnabled
      });
      if (!this.isCurrent(generation)) {
        return;
      }

      if (!isEnabled) {
        this.renderMessage(
          `Rooster editor is not enabled for work item type "${this.activeWit || "Unknown"}".`,
          generation
        );
        return;
      }

      const rawValue = await this.dependencies.bridge.getFieldValue(this.config.fieldName);
      if (!this.isCurrent(generation)) {
        return;
      }
      const normalizedValue = this.dependencies.normalizer.normalizeHtml(rawValue);
      if (!this.isCurrent(generation)) {
        return;
      }

      if (this.isReadOnly) {
        this.mountReadOnly(normalizedValue, generation);
        return;
      }

      this.mountEditor(normalizedValue, generation);
    } catch (error) {
      if (!this.isCurrent(generation)) {
        return;
      }

      this.disposeResources();
      if (!this.isCurrent(generation)) {
        return;
      }
      this.clearLifecycleState();
      this.warnSafely("initial_read_failed");
      if (!this.isCurrent(generation)) {
        return;
      }
      const message = formatPublicError(error, INITIALIZATION_FALLBACK);
      if (!this.isCurrent(generation)) {
        return;
      }
      this.renderMessage(
        `${INITIALIZATION_FAILURE_PREFIX}${message}`,
        generation
      );
    }
  };

  onFieldChanged = async (fieldChangedArgs: IWorkItemFieldChangedArgs): Promise<void> => {
    const generation = this.generation;
    if (this.activeMode === "none") {
      return;
    }
    const contentRequestOrdinal = ++this.contentRequestOrdinal;
    const presentationRevision = this.presentationRevision;
    let hasConfiguredFieldChanged: boolean;
    try {
      hasConfiguredFieldChanged = this.dependencies.bridge.hasFieldChanged(
        fieldChangedArgs,
        this.config.fieldName
      );
    } catch {
      if (this.isCurrent(generation)) {
        this.latestContentRequestOrdinal = Math.max(
          this.latestContentRequestOrdinal,
          contentRequestOrdinal
        );
        this.warnSafely("field_change_filter_failed");
      }
      return;
    }
    if (!hasConfiguredFieldChanged || !this.isCurrent(generation)) {
      return;
    }
    this.latestContentRequestOrdinal = Math.max(
      this.latestContentRequestOrdinal,
      contentRequestOrdinal
    );
    try {
      const rawValue = await this.dependencies.bridge.getFieldValue(this.config.fieldName);
      if (
        !this.isCurrentContentPresentationRequest(
          generation,
          contentRequestOrdinal,
          presentationRevision
        )
      ) {
        return;
      }
      const normalizedValue = this.dependencies.normalizer.normalizeHtml(rawValue);
      if (
        !this.isCurrentContentPresentationRequest(
          generation,
          contentRequestOrdinal,
          presentationRevision
        )
      ) {
        return;
      }

      if (this.activeMode === "readonly") {
        const view = this.readOnlyView;
        if (view) {
          view.setHtml(normalizedValue);
        }
        return;
      }

      const host = this.host;
      const sync = this.syncEngine;
      if (!host || !sync) {
        return;
      }
      const isEcho = sync.isEcho(normalizedValue);
      if (
        isEcho ||
        !this.isCurrentContentPresentationRequest(
          generation,
          contentRequestOrdinal,
          presentationRevision
        ) ||
        this.host !== host ||
        this.syncEngine !== sync
      ) {
        return;
      }

      const externalRevision = this.advanceExternalPresentation(
        generation,
        host,
        sync,
        presentationRevision
      );
      if (externalRevision === null) {
        return;
      }

      sync.alignToHost(normalizedValue);
      if (
        !this.isCurrentContentRequest(generation, contentRequestOrdinal) ||
        this.presentationRevision !== externalRevision ||
        this.host !== host ||
        this.syncEngine !== sync
      ) {
        return;
      }
      host.setHtml(normalizedValue);
    } catch {
      if (this.isCurrentContentRequest(generation, contentRequestOrdinal)) {
        this.warnSafely("field_change_read_failed");
      }
    }
  };

  onSaved = async (_savedEventArgs: IWorkItemChangedArgs): Promise<void> => {
    const generation = this.generation;
    const sync = this.syncEngine;
    if (!sync || this.activeMode !== "editable") {
      return;
    }
    const presentationRevision = this.presentationRevision;

    let flushFailed = false;
    let flushError: unknown;
    try {
      await sync.flush();
    } catch (error) {
      flushFailed = true;
      flushError = error;
    }

    if (
      !this.isCurrent(generation) ||
      this.syncEngine !== sync ||
      this.presentationRevision !== presentationRevision
    ) {
      return;
    }

    const host = this.host;
    if (!host) {
      return;
    }

    if (flushFailed) {
      const message = formatPublicError(flushError, AUTOSYNC_FALLBACK);
      if (
        !this.isCurrent(generation) ||
        this.syncEngine !== sync ||
        this.host !== host ||
        this.presentationRevision !== presentationRevision
      ) {
        return;
      }
      this.setStatusSafely(host, `Autosync failed: ${message}`);
      return;
    }

    let status: string;
    try {
      status = this.formatSyncedStatus(this.dependencies.now());
    } catch {
      return;
    }

    if (
      this.isCurrent(generation) &&
      this.syncEngine === sync &&
      this.host === host &&
      this.presentationRevision === presentationRevision
    ) {
      this.setStatusSafely(host, status);
    }
  };

  onRefreshed = async (_refreshEventArgs: IWorkItemChangedArgs): Promise<void> => {
    await this.reloadFromForm("refresh_read_failed");
  };

  onReset = async (_undoEventArgs: IWorkItemChangedArgs): Promise<void> => {
    await this.reloadFromForm("reset_read_failed");
  };

  onUnloaded = async (_unloadedEventArgs: IWorkItemChangedArgs): Promise<void> => {
    const generation = this.beginGeneration();
    if (this.isCurrent(generation)) {
      this.renderMessage("Work item unloaded.", generation);
    }
  };

  private mountReadOnly(normalizedValue: string, generation: number): void {
    if (!this.isCurrent(generation)) {
      return;
    }

    const view = this.dependencies.createReadOnlyView(this.root);
    if (!this.isCurrent(generation)) {
      this.disposeSafely(() => view.dispose(), "readonly_dispose_failed");
      return;
    }

    this.readOnlyView = view;
    this.activeMode = "readonly";
    view.setHtml(normalizedValue);
    if (!this.isCurrent(generation) || this.readOnlyView !== view) {
      return;
    }
    this.trackSafely("readonly_rendered", {
      wit: this.activeWit || "Unknown",
      fieldName: this.config.fieldName
    });
  }

  private mountEditor(normalizedValue: string, generation: number): void {
    if (!this.isCurrent(generation)) {
      return;
    }

    let host: EditorHost | null = null;
    const createdHost = this.dependencies.createEditor(this.root, {
      enableMarkdownAutoformat: this.config.enableMarkdownAutoformat,
      enableCodeBlock: this.config.enableCodeBlock,
      onFeatureUsed: feature => {
        if (
          !host ||
          !this.isCurrent(generation) ||
          this.activeMode !== "editable" ||
          this.host !== host
        ) {
          return;
        }
        this.trackFeatureSafely(feature, {
          wit: this.activeWit || "Unknown",
          fieldName: this.config.fieldName
        });
      }
    });
    host = createdHost;

    if (!this.isCurrent(generation)) {
      this.disposeSafely(() => createdHost.dispose(), "editor_dispose_failed");
      return;
    }

    this.host = createdHost;
    createdHost.setHtml(normalizedValue);
    if (!this.isCurrentEditor(generation, createdHost)) {
      return;
    }
    createdHost.setReadOnly(false);
    if (!this.isCurrentEditor(generation, createdHost)) {
      return;
    }
    this.setStatusSafely(
      createdHost,
      `Editing ${this.config.fieldName} on ${this.activeWit}`
    );
    if (!this.isCurrentEditor(generation, createdHost)) {
      return;
    }

    let sync: SyncPort | null = null;
    const createdSync = this.dependencies.createSync({
      debounceMs: this.config.debounceMs,
      normalizer: this.dependencies.normalizer,
      writeValue: async value => {
        await this.dependencies.bridge.setFieldValue(this.config.fieldName, value);
      },
      onWriteSuccess: (_value, request) => {
        if (!sync || !this.isCurrent(generation) || this.syncEngine !== sync) {
          return;
        }
        const activeHost = this.host;
        if (!activeHost) {
          return;
        }
        if (!this.isCurrentSyncRequest(generation, activeHost, sync, request)) {
          return;
        }
        this.trackSafely("autosync_success", {
          wit: this.activeWit || "Unknown",
          fieldName: this.config.fieldName
        });
        if (
          this.isCurrentSyncRequest(generation, activeHost, sync, request)
        ) {
          this.setStatusSafely(activeHost, "Autosynced");
        }
        this.clearSyncRequest(request);
      },
      onAlreadySatisfied: request => {
        if (!sync || !this.isCurrent(generation) || this.syncEngine !== sync) {
          return;
        }
        const activeHost = this.host;
        if (!activeHost || !this.isCurrentSyncRequest(generation, activeHost, sync, request)) {
          return;
        }
        this.trackSafely("autosync_success", {
          wit: this.activeWit || "Unknown",
          fieldName: this.config.fieldName
        });
        if (this.isCurrentSyncRequest(generation, activeHost, sync, request)) {
          this.setStatusSafely(activeHost, "Autosynced");
        }
        this.clearSyncRequest(request);
      },
      onError: (error, request) => {
        if (!sync || !this.isCurrent(generation) || this.syncEngine !== sync) {
          return;
        }
        const activeHost = this.host;
        if (!activeHost) {
          return;
        }
        if (!this.isCurrentSyncRequest(generation, activeHost, sync, request)) {
          return;
        }
        const message = formatPublicError(error, AUTOSYNC_FALLBACK);
        if (!this.isCurrentSyncRequest(generation, activeHost, sync, request)) {
          return;
        }
        const errorCode = this.getErrorCode(error);
        if (!this.isCurrentSyncRequest(generation, activeHost, sync, request)) {
          return;
        }
        this.trackSafely("autosync_failure", {
          wit: this.activeWit || "Unknown",
          fieldName: this.config.fieldName,
          errorCode,
          operation: "autosync"
        });
        if (
          this.isCurrentSyncRequest(generation, activeHost, sync, request)
        ) {
          this.setStatusSafely(activeHost, `Autosync failed: ${message}`);
        }
        this.clearSyncRequest(request);
      }
    });
    sync = createdSync;

    if (!this.isCurrentEditor(generation, createdHost)) {
      this.disposeSafely(() => createdSync.dispose(), "sync_dispose_failed");
      return;
    }

    this.syncEngine = createdSync;
    this.activeMode = "editable";
    createdSync.alignToHost(normalizedValue);
    if (!this.isCurrentEditorSync(generation, createdHost, createdSync)) {
      return;
    }

    this.host = null;
    this.syncEngine = null;
    this.activeMode = "none";
    let subscriptionCommitted = false;
    let disposeHostChange: unknown;
    try {
      disposeHostChange = createdHost.onChange(nextHtml => {
        if (
          !subscriptionCommitted ||
          !this.isCurrentEditorSync(generation, createdHost, createdSync)
        ) {
          return;
        }
        const presentationRevision = ++this.presentationRevision;
        const request = Symbol();
        this.latestSyncRequest = {
          token: request,
          revision: presentationRevision
        };
        createdSync.schedule(nextHtml, request);
        if (
          !this.isCurrentSyncRequest(generation, createdHost, createdSync, request)
        ) {
          return;
        }
        this.setStatusSafely(createdHost, "Pending autosync...");
      });
    } catch (error) {
      this.disposeStagedEditor(null, createdSync, createdHost);
      throw error;
    }

    if (typeof disposeHostChange !== "function") {
      this.disposeStagedEditor(null, createdSync, createdHost);
      throw new Error("Host change subscription did not return a disposer.");
    }
    const unsubscribe = disposeHostChange as () => void;
    if (!this.isCurrent(generation)) {
      this.disposeStagedEditor(unsubscribe, createdSync, createdHost);
      return;
    }

    this.host = createdHost;
    this.syncEngine = createdSync;
    this.activeMode = "editable";
    this.disposeHostChange = unsubscribe;
    subscriptionCommitted = true;
  }

  private async reloadFromForm(operationCode: string): Promise<void> {
    const generation = this.generation;
    if (this.activeMode === "none") {
      return;
    }
    const contentRequestOrdinal = ++this.contentRequestOrdinal;
    this.latestContentRequestOrdinal = contentRequestOrdinal;
    const presentationRevision = this.presentationRevision;

    try {
      const rawValue = await this.dependencies.bridge.getFieldValue(this.config.fieldName);
      if (
        !this.isCurrentContentPresentationRequest(
          generation,
          contentRequestOrdinal,
          presentationRevision
        )
      ) {
        return;
      }
      const normalizedValue = this.dependencies.normalizer.normalizeHtml(rawValue);
      if (
        !this.isCurrentContentPresentationRequest(
          generation,
          contentRequestOrdinal,
          presentationRevision
        )
      ) {
        return;
      }

      if (this.activeMode === "readonly") {
        const view = this.readOnlyView;
        if (view) {
          view.setHtml(normalizedValue);
        }
        return;
      }

      const host = this.host;
      const sync = this.syncEngine;
      if (!host || !sync) {
        return;
      }
      const externalRevision = this.advanceExternalPresentation(
        generation,
        host,
        sync,
        presentationRevision
      );
      if (externalRevision === null) {
        return;
      }
      sync.alignToHost(normalizedValue);
      if (
        !this.isCurrentContentRequest(generation, contentRequestOrdinal) ||
        this.presentationRevision !== externalRevision ||
        this.host !== host ||
        this.syncEngine !== sync
      ) {
        return;
      }
      host.setHtml(normalizedValue);
      if (
        !this.isCurrentContentRequest(generation, contentRequestOrdinal) ||
        this.presentationRevision !== externalRevision ||
        this.host !== host ||
        this.syncEngine !== sync
      ) {
        return;
      }
      this.setStatusSafely(host, "Reloaded from work item form");
    } catch {
      if (this.isCurrentContentRequest(generation, contentRequestOrdinal)) {
        this.warnSafely(operationCode);
      }
    }
  }

  private beginGeneration(): number {
    const generation = this.generation + 1;
    this.generation = generation;
    this.latestContentRequestOrdinal = ++this.contentRequestOrdinal;
    this.disposeResources();
    this.clearLifecycleState();
    return generation;
  }

  private disposeResources(): void {
    const disposeHostChange = this.disposeHostChange;
    const syncEngine = this.syncEngine;
    const host = this.host;
    const readOnlyView = this.readOnlyView;

    this.disposeHostChange = null;
    this.syncEngine = null;
    this.host = null;
    this.readOnlyView = null;
    this.clearLifecycleState();

    this.disposeSafely(disposeHostChange, "unsubscribe_failed");
    this.disposeSafely(syncEngine ? () => syncEngine.dispose() : null, "sync_dispose_failed");
    this.disposeSafely(host ? () => host.dispose() : null, "editor_dispose_failed");
    this.disposeSafely(
      readOnlyView ? () => readOnlyView.dispose() : null,
      "readonly_dispose_failed"
    );
  }

  private disposeStagedEditor(
    disposeHostChange: (() => void) | null,
    sync: SyncPort,
    host: EditorHost
  ): void {
    this.disposeSafely(disposeHostChange, "unsubscribe_failed");
    this.disposeSafely(() => sync.dispose(), "sync_dispose_failed");
    this.disposeSafely(() => host.dispose(), "editor_dispose_failed");
  }

  private disposeSafely(dispose: (() => void) | null, operationCode: string): void {
    if (!dispose) {
      return;
    }

    try {
      dispose();
    } catch {
      this.warnSafely(operationCode);
    }
  }

  private trackSafely(
    eventName: Parameters<TelemetryClient["track"]>[0],
    properties: Readonly<Record<string, unknown>>
  ): void {
    try {
      this.dependencies.telemetry.track(eventName, properties);
    } catch {
      // Telemetry is observational and cannot alter lifecycle behavior.
    }
  }

  private trackFeatureSafely(
    feature: Parameters<TelemetryClient["trackFeature"]>[0],
    properties: Readonly<Record<string, unknown>>
  ): void {
    try {
      this.dependencies.telemetry.trackFeature(feature, properties);
    } catch {
      // Telemetry is observational and cannot alter lifecycle behavior.
    }
  }

  private setStatusSafely(
    target: { setStatus(text: string): void } | null,
    status: string
  ): void {
    try {
      target?.setStatus(status);
    } catch {
      // Status sinks are observational and cannot alter lifecycle behavior.
    }
  }

  private warnSafely(operationCode: string): void {
    try {
      console.warn(`[rdx-control] ${operationCode}`);
    } catch {
      // Host-provided diagnostics must not alter lifecycle behavior.
    }
  }

  private clearLifecycleState(): void {
    this.activeWit = "";
    this.isReadOnly = false;
    this.activeMode = "none";
    this.presentationRevision = 0;
    this.latestSyncRequest = null;
  }

  private isCurrent(generation: number): boolean {
    return generation === this.generation;
  }

  private isCurrentContentRequest(
    generation: number,
    contentRequestOrdinal: number
  ): boolean {
    return (
      this.isCurrent(generation) &&
      contentRequestOrdinal === this.latestContentRequestOrdinal
    );
  }

  private isCurrentContentPresentationRequest(
    generation: number,
    contentRequestOrdinal: number,
    presentationRevision: number
  ): boolean {
    return (
      this.isCurrentContentRequest(generation, contentRequestOrdinal) &&
      this.presentationRevision === presentationRevision
    );
  }

  private isCurrentEditor(generation: number, host: EditorHost): boolean {
    return this.isCurrent(generation) && this.host === host;
  }

  private isCurrentEditorSync(
    generation: number,
    host: EditorHost,
    sync: SyncPort
  ): boolean {
    return (
      this.isCurrentEditor(generation, host) &&
      this.activeMode === "editable" &&
      this.syncEngine === sync
    );
  }

  private isCurrentEditorSyncPresentation(
    generation: number,
    host: EditorHost,
    sync: SyncPort,
    presentationRevision: number
  ): boolean {
    return (
      this.isCurrentEditorSync(generation, host, sync) &&
      this.presentationRevision === presentationRevision
    );
  }

  private isCurrentSyncRequest(
    generation: number,
    host: EditorHost,
    sync: SyncPort,
    request: SyncRequestToken
  ): boolean {
    const latestRequest = this.latestSyncRequest;
    if (!latestRequest || latestRequest.token !== request) {
      return false;
    }
    return (
      this.isCurrentEditorSyncPresentation(
        generation,
        host,
        sync,
        latestRequest.revision
      )
    );
  }

  private clearSyncRequest(request: SyncRequestToken): void {
    if (this.latestSyncRequest?.token === request) {
      this.latestSyncRequest = null;
    }
  }

  private advanceExternalPresentation(
    generation: number,
    host: EditorHost,
    sync: SyncPort,
    expectedRevision: number
  ): number | null {
    if (
      !this.isCurrentEditorSyncPresentation(
        generation,
        host,
        sync,
        expectedRevision
      )
    ) {
      return null;
    }

    const externalRevision = ++this.presentationRevision;
    this.latestSyncRequest = null;
    return externalRevision;
  }

  private renderMessage(message: string, generation: number): void {
    if (!this.isCurrent(generation)) {
      return;
    }

    this.queueMessage({ generation, message });
    this.drainPendingMessages(true);
  }

  private drainPendingMessages(allowDeferredRetry: boolean): void {
    if (this.isRenderingMessage) {
      return;
    }

    this.isRenderingMessage = true;
    let remainingAttempts = MAX_MESSAGE_RENDER_ATTEMPTS;
    try {
      while (remainingAttempts > 0) {
        const request = this.pendingMessage;
        if (!request) {
          return;
        }
        if (!this.isCurrent(request.generation)) {
          if (this.pendingMessage === request) {
            this.pendingMessage = null;
          }
          continue;
        }
        this.pendingMessage = null;
        const requestGeneration = request.generation;

        let didCommit = false;
        while (remainingAttempts > 1 && this.isCurrent(requestGeneration)) {
          remainingAttempts -= 1;
          try {
            const messageNode = document.createElement("div");
            messageNode.className = "rdx-message";
            messageNode.textContent = request.message;
            if (!this.isCurrent(requestGeneration)) {
              break;
            }
            this.root.replaceChildren(messageNode);
            if (!this.isCurrent(requestGeneration)) {
              break;
            }
            if (this.pendingMessage === request) {
              this.pendingMessage = null;
            }
            didCommit = true;
            break;
          } catch {
            this.warnSafely("message_render_failed");
            if (!this.isCurrent(requestGeneration)) {
              break;
            }
            this.queueMessage(request);
          }
        }

        if (!this.isCurrent(requestGeneration)) {
          continue;
        }

        if (didCommit) {
          if (this.pendingMessage) {
            continue;
          }
          return;
        }

        const fallbackRequest = this.pendingMessage ?? request;
        if (!this.isCurrent(fallbackRequest.generation)) {
          if (this.pendingMessage === fallbackRequest) {
            this.pendingMessage = null;
          }
          continue;
        }
        this.queueMessage(fallbackRequest);
        const fallbackOwner = this.pendingMessage as PendingMessage | null;
        if (!fallbackOwner || !this.isCurrent(fallbackOwner.generation)) {
          continue;
        }

        remainingAttempts -= 1;

        try {
          this.root.textContent = fallbackOwner.message;
          if (this.pendingMessage === fallbackOwner) {
            this.pendingMessage = null;
          }
        } catch {
          this.warnSafely("message_render_failed");
          this.queueMessage(fallbackOwner);
        }

        if (!this.pendingMessage) {
          return;
        }
      }
    } finally {
      this.isRenderingMessage = false;
    }

    const retainedRequest = this.pendingMessage;
    if (
      allowDeferredRetry &&
      retainedRequest &&
      this.isCurrent(retainedRequest.generation)
    ) {
      const shouldScheduleRetry = this.scheduledMessageRetry === null;
      this.scheduledMessageRetry = retainedRequest;
      if (shouldScheduleRetry) {
        queueMicrotask(() => {
          const retryRequest = this.scheduledMessageRetry;
          this.scheduledMessageRetry = null;
          if (!retryRequest || this.pendingMessage !== retryRequest) {
            return;
          }
          if (!this.isCurrent(retryRequest.generation)) {
            this.pendingMessage = null;
            return;
          }
          this.drainPendingMessages(false);
        });
      }
    }
  }

  private queueMessage(request: PendingMessage): void {
    if (!this.pendingMessage || request.generation >= this.pendingMessage.generation) {
      this.pendingMessage = request;
    }
  }

  private formatSyncedStatus(date?: Date): string {
    if (!date) {
      return `Synced (${new Date().toLocaleTimeString()})`;
    }

    return `Synced (${date.toLocaleTimeString()})`;
  }

  private getErrorCode(error: unknown): string {
    let errorName: string;
    try {
      if (!(error instanceof Error) || typeof error.name !== "string") {
        return "UnknownError";
      }
      errorName = error.name;
    } catch {
      return "UnknownError";
    }

    const errorCode = formatPublicError(new Error(errorName), "UnknownError");
    return /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(errorCode) ? errorCode : "UnknownError";
  }
}
