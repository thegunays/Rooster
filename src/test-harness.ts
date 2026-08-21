import { Sanitizer } from "./bridge/Sanitizer";
import { SyncEngine } from "./bridge/SyncEngine";
import { getControlConfig } from "./config/defaults";
import { RoosterDescriptionControl } from "./control/RoosterDescriptionControl";
import { createReadOnlyView } from "./control/ReadOnlyView";
import { RoosterHost } from "./control/RoosterHost";
import { TelemetryClient } from "./telemetry/TelemetryClient";
import { FakeWorkItemHost } from "../test/support/FakeWorkItemHost";

const CUSTOM_FIELD = "Custom.RoosterContent";
const DESCRIPTION_FIELD = "System.Description";

export type HarnessAction =
  | "load"
  | "load-bku"
  | "field-change"
  | "save"
  | "refresh"
  | "reset"
  | "unload"
  | "reload"
  | "clear-log";

export interface TestHarnessOptions {
  readonly loadBku?: () => Promise<string>;
}

export interface TestHarness {
  readonly host: FakeWorkItemHost;
  runAction(action: HarnessAction): Promise<void>;
  dispose(): void;
}

function utf8ByteLength(value: string | undefined): number {
  return value === undefined ? 0 : new TextEncoder().encode(value).byteLength;
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

function createLabel(text: string, control: HTMLElement): HTMLLabelElement {
  const label = createElement("label", "rdx-harness-setting");
  const caption = createElement("span", "rdx-harness-setting-label", text);
  label.append(caption, control);
  return label;
}

function createActionButton(action: HarnessAction, label: string): HTMLButtonElement {
  const button = createElement("button", "rdx-harness-action", label);
  button.type = "button";
  button.dataset.harnessAction = action;
  return button;
}

function loadBkuFromServer(): Promise<string> {
  return fetch("test/fixtures/bku-template.html", { cache: "no-store" }).then(response => {
    if (!response.ok) {
      throw new Error(`BKU fixture request failed (${response.status}).`);
    }
    return response.text();
  });
}

export function mountTestHarness(
  root: HTMLElement,
  options: TestHarnessOptions = {}
): TestHarness {
  const host = new FakeWorkItemHost({
    fields: {
      [CUSTOM_FIELD]: "",
      [DESCRIPTION_FIELD]: ""
    },
    workItemType: "SRS",
    writeEcho: "immediate"
  });
  const loadBku = options.loadBku ?? loadBkuFromServer;
  let control: RoosterDescriptionControl | null = null;
  let disposed = false;
  let actionTail = Promise.resolve();

  const harness = createElement("div", "rdx-harness");
  harness.dataset.harnessRoot = "";

  const header = createElement("header", "rdx-harness-header");
  header.append(
    createElement("div", "rdx-harness-kicker", "LOCAL REGRESSION HARNESS"),
    createElement("h1", "rdx-harness-title", "Rooster Description field isolation"),
    createElement(
      "p",
      "rdx-harness-summary",
      "Exercise the production controller against an in-memory Work Item boundary."
    )
  );

  const settings = createElement("section", "rdx-harness-settings");
  settings.setAttribute("aria-label", "Harness configuration");

  const fieldName = createElement("input");
  fieldName.id = "harness-field-name";
  fieldName.type = "text";
  fieldName.value = CUSTOM_FIELD;
  fieldName.spellcheck = false;

  const wit = createElement("select");
  wit.id = "harness-wit";
  for (const value of ["SRS", "HLD", "Bug"]) {
    const option = createElement("option", undefined, value);
    option.value = value;
    wit.appendChild(option);
  }

  const readOnly = createElement("input");
  readOnly.id = "harness-read-only";
  readOnly.type = "checkbox";

  const narrow = createElement("input");
  narrow.id = "harness-narrow";
  narrow.type = "checkbox";

  const echo = createElement("select");
  echo.id = "harness-echo";
  for (const value of ["immediate", "delayed", "none"] as const) {
    const option = createElement("option", undefined, value);
    option.value = value;
    echo.appendChild(option);
  }

  settings.append(
    createLabel("FieldName", fieldName),
    createLabel("Work item type", wit),
    createLabel("Read-only", readOnly),
    createLabel("Narrow preview", narrow),
    createLabel("Write echo", echo)
  );

  const actions = createElement("section", "rdx-harness-actions");
  actions.setAttribute("aria-label", "Lifecycle actions");
  const actionDefinitions: ReadonlyArray<readonly [HarnessAction, string]> = [
    ["load", "Load"],
    ["load-bku", "Load BKU"],
    ["field-change", "Field change"],
    ["save", "Save"],
    ["refresh", "Refresh"],
    ["reset", "Reset"],
    ["unload", "Unload"],
    ["reload", "Reload"],
    ["clear-log", "Clear log"]
  ];
  actionDefinitions.forEach(([action, label]) => {
    actions.appendChild(createActionButton(action, label));
  });

  const externalValue = createElement("textarea");
  externalValue.id = "harness-external-value";
  externalValue.rows = 2;
  externalValue.value = "<p>External field change</p>";
  actions.appendChild(createLabel("External field HTML", externalValue));

  const actionStatus = createElement("div", "rdx-harness-action-status", "Ready to load.");
  actionStatus.dataset.harnessActionStatus = "";
  actionStatus.setAttribute("role", "status");
  actionStatus.setAttribute("aria-live", "polite");

  const workspace = createElement("div", "rdx-harness-workspace");
  const preview = createElement("section", "rdx-harness-preview");
  preview.dataset.harnessPreview = "";
  preview.setAttribute("aria-label", "Control preview");
  const previewHeading = createElement("div", "rdx-harness-panel-heading");
  previewHeading.append(
    createElement("h2", undefined, "Control preview"),
    createElement("span", "rdx-harness-badge", "production modules")
  );
  const messageProbe = createElement("div", "rdx-message", "Chrome isolation probe");
  messageProbe.dataset.harnessMessageProbe = "";
  const controlRoot = createElement("div", "rdx-app rdx-harness-control-root");
  controlRoot.dataset.harnessControlRoot = "";
  preview.append(previewHeading, messageProbe, controlRoot);

  const diagnostics = createElement("aside", "rdx-harness-diagnostics");
  diagnostics.setAttribute("aria-label", "Work Item diagnostics");
  diagnostics.appendChild(createElement("h2", undefined, "Field diagnostics"));

  const rawNodes = new Map<string, HTMLElement>();
  const hashNodes = new Map<string, HTMLElement>();
  for (const field of [CUSTOM_FIELD, DESCRIPTION_FIELD]) {
    const card = createElement("section", "rdx-harness-field-card");
    card.dataset.fieldPanel = field;
    const title = createElement("h3", undefined, field);
    const hash = createElement("code", "rdx-harness-hash");
    hash.dataset.fieldHash = field;
    const raw = createElement("pre", "rdx-harness-raw");
    raw.dataset.rawField = field;
    card.append(title, createElement("span", "rdx-harness-meta", "SHA-256"), hash, raw);
    diagnostics.appendChild(card);
    rawNodes.set(field, raw);
    hashNodes.set(field, hash);
  }

  const logHeading = createElement("h3", undefined, "Mock host read/write log");
  const log = createElement("pre", "rdx-harness-log");
  log.dataset.harnessLog = "";
  diagnostics.append(logHeading, log);

  workspace.append(preview, diagnostics);
  harness.append(header, settings, actions, actionStatus, workspace);
  root.replaceChildren(harness);

  const renderDiagnostics = (): void => {
    for (const field of [CUSTOM_FIELD, DESCRIPTION_FIELD]) {
      const raw = host.getRawField(field);
      const rawNode = rawNodes.get(field);
      const hashNode = hashNodes.get(field);
      if (rawNode) {
        rawNode.textContent = raw;
      }
      if (hashNode) {
        hashNode.textContent = host.sha256(field);
      }
    }

    const eventLines = host.events.map(event => `EVENT ${event}`);
    const readLines = host.reads.map(
      read => `READ ${read.fieldName} ${read.outcome} bytes=${utf8ByteLength(read.value)}`
    );
    const writeLines = host.writes.map(
      write => `WRITE ${write.fieldName} ${write.outcome} bytes=${utf8ByteLength(write.value)}`
    );
    const checkLines = host.fieldChecks.map(field => `CHECK changedFields.${field}`);
    log.textContent = [...eventLines, ...readLines, ...writeLines, ...checkLines].join("\n");
  };
  const disposeLogObserver = host.onLogChange(renderDiagnostics);
  renderDiagnostics();

  narrow.addEventListener("change", () => {
    preview.classList.toggle("is-narrow", narrow.checked);
  });

  const currentFieldName = (): string => fieldName.value.trim() || CUSTOM_FIELD;

  const mountSession = async (): Promise<void> => {
    if (control) {
      await host.unload();
    }
    host.setWorkItemType(wit.value);
    host.setReadOnly(readOnly.checked);
    host.setWriteEcho(echo.value as "immediate" | "delayed" | "none");
    const normalizer = new Sanitizer();
    const config = getControlConfig({
      witInputs: {
        FieldName: currentFieldName(),
        EnabledWits: "SRS,HLD",
        DebounceMs: "25",
        EnableMarkdownAutoformat: "true",
        EnableCodeBlock: "true"
      }
    });
    const telemetry = new TelemetryClient({
      extensionVersion: "local-harness",
      hostType: "Unknown",
      info: () => undefined
    });
    control = new RoosterDescriptionControl(controlRoot, config, {
      bridge: host,
      normalizer,
      telemetry,
      createEditor: (target, editorOptions) => new RoosterHost(target, editorOptions),
      createReadOnlyView,
      createSync: syncOptions => new SyncEngine(syncOptions),
      now: () => new Date()
    });
    host.attach(control);
    await host.load();
  };

  const executeAction = async (action: HarnessAction): Promise<void> => {
    if (disposed) {
      throw new Error("The harness has been disposed.");
    }
    actionStatus.textContent = `Running ${action}...`;
    switch (action) {
      case "load":
        await mountSession();
        break;
      case "load-bku": {
        const bku = await loadBku();
        host.setRawField(DESCRIPTION_FIELD, bku);
        host.setRawField(currentFieldName(), bku);
        host.captureSavedState();
        await mountSession();
        break;
      }
      case "field-change":
        await host.changeFields({ [currentFieldName()]: externalValue.value });
        break;
      case "save":
        await host.save();
        await host.deliverDelayedEchoes();
        break;
      case "refresh":
        await host.refresh();
        break;
      case "reset":
        await host.reset();
        break;
      case "unload":
        await host.unload();
        break;
      case "reload":
        await host.reload();
        break;
      case "clear-log":
        host.clearLog();
        break;
    }
    renderDiagnostics();
    actionStatus.textContent = `${action} complete.`;
  };

  const runAction = (action: HarnessAction): Promise<void> => {
    const operation = actionTail.then(() => executeAction(action));
    actionTail = operation.catch(() => undefined);
    return operation;
  };

  actions.querySelectorAll<HTMLButtonElement>("[data-harness-action]").forEach(button => {
    button.addEventListener("click", () => {
      const action = button.dataset.harnessAction as HarnessAction;
      void runAction(action).catch(error => {
        const message = error instanceof Error ? error.message : "Unknown harness failure";
        actionStatus.textContent = `${action} failed: ${message}`;
      });
    });
  });

  return {
    host,
    runAction,
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      disposeLogObserver();
      if (control) {
        void control.onUnloaded({ id: 123 });
        control = null;
      }
      root.replaceChildren();
    }
  };
}

if (typeof document !== "undefined" && document.currentScript) {
  const root = document.getElementById("app");
  if (root instanceof HTMLElement) {
    mountTestHarness(root);
  }
}
