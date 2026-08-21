import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { Sanitizer } from "../../src/bridge/Sanitizer";
import { SyncEngine } from "../../src/bridge/SyncEngine";
import { getControlConfig } from "../../src/config/defaults";
import {
  RoosterDescriptionControl,
  type ControllerDependencies
} from "../../src/control/RoosterDescriptionControl";
import { createReadOnlyView } from "../../src/control/ReadOnlyView";
import { RoosterHost } from "../../src/control/RoosterHost";
import { TelemetryClient } from "../../src/telemetry/TelemetryClient";
import {
  FakeWorkItemHost,
  type FakeWorkItemHostOptions
} from "../support/FakeWorkItemHost";

const BKU_FIXTURE = readFileSync(
  resolve(process.cwd(), "test/fixtures/bku-template.html"),
  "utf8"
);
const TARGET_FIELD = "Custom.RoosterContent";

interface IntegrationFixture {
  readonly control: RoosterDescriptionControl;
  readonly host: FakeWorkItemHost;
  readonly root: HTMLDivElement;
}

function createFixture(
  hostOptions: FakeWorkItemHostOptions = {},
  fieldName = TARGET_FIELD,
  debounceMs = 25
): IntegrationFixture {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const host = new FakeWorkItemHost({
    fields: {
      "System.Description": "<p>Description sentinel</p>",
      [TARGET_FIELD]: "<p>initial</p>",
      ...hostOptions.fields
    },
    ...hostOptions
  });
  const normalizer = new Sanitizer();
  const config = getControlConfig({
    witInputs: {
      FieldName: fieldName,
      EnabledWits: "SRS,HLD",
      DebounceMs: String(debounceMs),
      EnableMarkdownAutoformat: "true",
      EnableCodeBlock: "true"
    }
  });
  const dependencies: ControllerDependencies = {
    bridge: host,
    normalizer,
    telemetry: new TelemetryClient({
      extensionVersion: "test",
      hostType: "Unknown",
      info: () => undefined
    }),
    createEditor: (target, options) => new RoosterHost(target, options),
    createReadOnlyView,
    createSync: options => new SyncEngine(options),
    now: () => {
      const now = new Date("2026-08-18T12:34:56.000Z");
      now.toLocaleTimeString = () => "12:34:56 PM";
      return now;
    }
  };
  const control = new RoosterDescriptionControl(root, config, dependencies);
  host.attach(control);
  return { control, host, root };
}

function editorElement(root: ParentNode): HTMLElement {
  const editor = root.querySelector<HTMLElement>(".rdx-editor");
  if (!editor) {
    throw new Error("Expected an editable Rooster host");
  }
  return editor;
}

function edit(root: ParentNode, text: string): void {
  const editor = editorElement(root);
  const contentRoot = editor.querySelector<HTMLElement>("[data-rdx-content-root]") ?? editor;
  contentRoot.insertAdjacentText("beforeend", text);
  editor.dispatchEvent(new InputEvent("input", { bubbles: true, data: text }));
}

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("controller lifecycle through the fake Work Item boundary", () => {
  it("mounts editable content and persists the debounced editor change", async () => {
    vi.useFakeTimers();
    const fixture = createFixture();

    await fixture.host.load();
    edit(fixture.root, " editable");
    await vi.advanceTimersByTimeAsync(25);

    const editor = editorElement(fixture.root);
    expect(editor.contentEditable).toBe("false");
    expect(
      editor.querySelector<HTMLElement>(":scope > [data-rdx-content-root]")?.contentEditable
    ).toBe("true");
    expect(fixture.host.getRawField(TARGET_FIELD)).toContain("editable");
    expect(fixture.host.writes.map(write => write.fieldName)).toEqual([TARGET_FIELD]);
  });

  it("renders only a read-only preview without creating editor synchronization or writes", async () => {
    const fixture = createFixture({ readOnly: true });

    await fixture.host.load();

    expect(fixture.root.querySelector(".rdx-readonly")?.textContent).toContain("initial");
    expect(fixture.root.querySelector(".rdx-editor")).toBeNull();
    expect(fixture.host.reads.map(read => read.fieldName)).toEqual([
      "System.WorkItemType",
      TARGET_FIELD
    ]);
    expect(fixture.host.writes).toEqual([]);
  });

  it("blocks target reads, editor construction, sync, and writes for an unsupported WIT", async () => {
    const fixture = createFixture({ workItemType: "Bug" });

    await fixture.host.load();

    expect(fixture.root.textContent).toBe(
      'Rooster editor is not enabled for work item type "Bug".'
    );
    expect(fixture.root.querySelector(".rdx-editor, .rdx-readonly")).toBeNull();
    expect(fixture.host.reads.map(read => read.fieldName)).toEqual(["System.WorkItemType"]);
    expect(fixture.host.writes).toEqual([]);
  });

  it("ignores non-target changes and presents target-field changes", async () => {
    const fixture = createFixture();
    await fixture.host.load();
    fixture.host.clearLog();
    const before = editorElement(fixture.root).innerHTML;

    await fixture.host.changeFields({ "System.Title": "new title" });

    expect(fixture.host.reads).toEqual([]);
    expect(editorElement(fixture.root).innerHTML).toBe(before);

    await fixture.host.changeFields({ [TARGET_FIELD]: "<h2>external</h2>" });

    expect(fixture.host.reads.map(read => read.fieldName)).toEqual([TARGET_FIELD]);
    expect(editorElement(fixture.root).textContent).toContain("external");
    expect(fixture.host.writes).toEqual([]);
  });

  it("rejects an inherited target-field entry at the Work Item callback boundary", async () => {
    const fixture = createFixture();
    await fixture.host.load();
    fixture.host.clearLog();
    const changedFields = Object.create({
      [TARGET_FIELD]: "<p>inherited target must not count</p>"
    }) as Record<string, unknown>;

    await fixture.host.emitFieldChanged(changedFields);

    expect(fixture.host.fieldChecks).toEqual([TARGET_FIELD]);
    expect(fixture.host.reads).toEqual([]);
    expect(fixture.host.writes).toEqual([]);
    expect(editorElement(fixture.root).textContent).toContain("initial");
  });

  it.each(["immediate", "delayed"] as const)(
    "suppresses a %s configured-field echo without a second write",
    async writeEcho => {
      vi.useFakeTimers();
      const fixture = createFixture({ writeEcho });
      await fixture.host.load();

      edit(fixture.root, ` ${writeEcho}`);
      await vi.advanceTimersByTimeAsync(25);
      await fixture.host.deliverDelayedEchoes();

      expect(fixture.host.writes).toHaveLength(1);
      expect(fixture.host.writes[0].fieldName).toBe(TARGET_FIELD);
      expect(editorElement(fixture.root).textContent).toContain(writeEcho);
    }
  );

  it("treats an echo delivered while the host write is pending as in-flight", async () => {
    vi.useFakeTimers();
    const fixture = createFixture();
    const pendingWrite = fixture.host.deferNextWrite();
    await fixture.host.load();

    edit(fixture.root, " pending");
    const timerAdvance = vi.advanceTimersByTimeAsync(25);
    await pendingWrite.entered;
    const pendingValue = fixture.host.writes[0]?.value;
    expect(pendingValue).toContain("pending");
    fixture.host.queueReadValue(TARGET_FIELD, pendingValue ?? "");
    await fixture.host.emitFieldChanged({
      [TARGET_FIELD]: pendingValue
    });
    pendingWrite.resolve();
    await timerAdvance;

    expect(fixture.host.writes).toHaveLength(1);
    expect(editorElement(fixture.root).textContent).toContain("pending");
  });

  it("flushes a queued change during save before the debounce expires", async () => {
    vi.useFakeTimers();
    const fixture = createFixture({}, TARGET_FIELD, 10_000);
    await fixture.host.load();

    edit(fixture.root, " save-flush");
    expect(fixture.host.writes).toEqual([]);
    await fixture.host.save();

    expect(fixture.host.writes).toHaveLength(1);
    expect(fixture.host.getRawField(TARGET_FIELD)).toContain("save-flush");
    expect(fixture.root.querySelector(".rdx-status")?.textContent).toBe(
      "Synced (12:34:56 PM)"
    );
  });

  it("keeps a rejected deferred write transactional without mutating or echoing", async () => {
    vi.useFakeTimers();
    const fixture = createFixture({ writeEcho: "immediate" });
    const pendingWrite = fixture.host.deferNextWrite();
    await fixture.host.load();
    const originalValue = fixture.host.getRawField(TARGET_FIELD);

    edit(fixture.root, " rejected");
    const timerAdvance = vi.advanceTimersByTimeAsync(25);
    await pendingWrite.entered;
    pendingWrite.reject(new Error("deferred write rejected"));
    await timerAdvance;

    expect(fixture.host.getRawField(TARGET_FIELD)).toBe(originalValue);
    expect(fixture.host.writes.map(write => write.outcome)).toEqual(["failed"]);
    expect(fixture.host.events.filter(event => event.startsWith("echo:"))).toEqual([]);
  });

  it("recovers from one write failure and persists the next editor change", async () => {
    vi.useFakeTimers();
    const fixture = createFixture();
    await fixture.host.load();
    fixture.host.failNextWrite(new Error("first write failed"));

    edit(fixture.root, " first");
    await vi.advanceTimersByTimeAsync(25);
    expect(fixture.root.querySelector(".rdx-status")?.textContent).toBe(
      "Autosync failed: first write failed"
    );

    await fixture.host.save();

    expect(fixture.host.writes.map(write => write.outcome)).toEqual(["failed"]);
    expect(fixture.root.querySelector(".rdx-status")?.textContent).toBe(
      "Autosync failed: first write failed"
    );

    edit(fixture.root, " second");
    await vi.advanceTimersByTimeAsync(25);

    expect(fixture.host.writes.map(write => write.outcome)).toEqual([
      "failed",
      "succeeded"
    ]);
    expect(fixture.host.getRawField(TARGET_FIELD)).toContain("second");
    expect(fixture.root.querySelector(".rdx-status")?.textContent).toBe("Autosynced");

    await fixture.host.save();
    expect(fixture.root.querySelector(".rdx-status")?.textContent).toBe(
      "Synced (12:34:56 PM)"
    );
  });

  it("reloads host state on refresh and the saved snapshot on reset", async () => {
    const fixture = createFixture();
    await fixture.host.load();

    fixture.host.setRawField(TARGET_FIELD, "<h2>refreshed</h2>");
    await fixture.host.refresh();
    expect(editorElement(fixture.root).textContent).toContain("refreshed");

    fixture.host.setRawField(TARGET_FIELD, "<h2>unsaved</h2>");
    await fixture.host.reset();
    expect(editorElement(fixture.root).textContent).toContain("initial");
  });

  it("unloads all active resources and reloads without duplicate change listeners", async () => {
    vi.useFakeTimers();
    const fixture = createFixture();
    await fixture.host.load();
    await fixture.host.unload();
    expect(fixture.root.textContent).toBe("Work item unloaded.");

    await fixture.host.reload();
    edit(fixture.root, " reopened");
    await vi.advanceTimersByTimeAsync(25);

    expect(fixture.root.querySelectorAll(".rdx-shell")).toHaveLength(1);
    expect(fixture.host.writes).toHaveLength(1);
  });

  it("prevents an older asynchronous load from replacing a newer generation", async () => {
    const fixture = createFixture();
    const oldRead = fixture.host.deferNextRead(TARGET_FIELD);
    const firstLoad = fixture.host.load();
    await fixture.host.waitForRead(TARGET_FIELD);
    fixture.host.setRawField(TARGET_FIELD, "<p>new generation</p>");

    const secondLoad = fixture.host.reload();
    await secondLoad;
    oldRead.resolve("<p>stale generation</p>");
    await firstLoad;

    expect(editorElement(fixture.root).textContent).toContain("new generation");
    expect(editorElement(fixture.root).textContent).not.toContain("stale generation");
  });

  it("keeps explicitly configured System.Description canonical across save, refresh, and reopen", async () => {
    vi.useFakeTimers();
    const fixture = createFixture(
      { fields: { "System.Description": BKU_FIXTURE } },
      "System.Description"
    );
    await fixture.host.load();

    edit(fixture.root, "s");
    await vi.advanceTimersByTimeAsync(25);
    await fixture.host.save();
    const afterSave = fixture.host.getRawField("System.Description");
    const afterSaveHash = fixture.host.sha256("System.Description");
    await fixture.host.refresh();
    const afterRefresh = fixture.host.getRawField("System.Description");
    await fixture.host.unload();
    await fixture.host.reload();

    expect(fixture.host.getRawField("System.Description")).toBe(afterSave);
    expect(fixture.host.sha256("System.Description")).toBe(afterSaveHash);
    expect(afterRefresh).toBe(afterSave);
    expect(editorElement(fixture.root).querySelectorAll("table")).toHaveLength(6);
    expect(
      editorElement(fixture.root).querySelectorAll(":scope > [data-rdx-content-root]")
    ).toHaveLength(1);
  });
});
