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
import { FakeWorkItemHost } from "../support/FakeWorkItemHost";

const originalDescription = readFileSync(
  resolve(process.cwd(), "test/fixtures/bku-template.html"),
  "utf8"
);

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("configured-field independence", () => {
  it("never changes the exact BKU Description bytes while editing and reopening a custom field", async () => {
    vi.useFakeTimers();
    const root = document.createElement("div");
    document.body.appendChild(root);
    const host = new FakeWorkItemHost({
      fields: {
        "System.Description": originalDescription,
        "Custom.RoosterContent": ""
      },
      workItemType: "SRS",
      writeEcho: "immediate"
    });
    const originalDescriptionHash = host.sha256("System.Description");
    expect(originalDescriptionHash).toBe(
      "0005e3eff97cc3aa39bbb2d90aa5b6f76b4435eb4b679d5ae3e1182b61c24b2a"
    );
    const normalizer = new Sanitizer();
    const config = getControlConfig({
      witInputs: {
        FieldName: "Custom.RoosterContent",
        EnabledWits: "SRS,HLD",
        DebounceMs: "25",
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
      now: () => new Date("2026-08-18T12:00:00.000Z")
    };
    const control = new RoosterDescriptionControl(root, config, dependencies);
    host.attach(control);

    await host.load();
    const editorShell = root.querySelector<HTMLElement>(".rdx-editor");
    const contentRoot = editorShell?.querySelector<HTMLElement>(
      ':scope > [data-rdx-content-root][aria-label="Description editor"]'
    );
    expect(editorShell?.contentEditable).toBe("false");
    expect(
      editorShell?.querySelectorAll(":scope > [data-rdx-content-root]")
    ).toHaveLength(1);
    expect(contentRoot?.contentEditable).toBe("true");

    contentRoot?.insertAdjacentText("beforeend", "s");
    contentRoot?.dispatchEvent(new InputEvent("input", { bubbles: true, data: "s" }));
    await vi.advanceTimersByTimeAsync(25);
    await host.save();
    await host.refresh();
    await host.unload();
    await host.reload();

    expect(
      host.writes.filter(write => write.fieldName === "System.Description")
    ).toEqual([]);
    expect(host.getRawField("System.Description")).toBe(originalDescription);
    expect(host.sha256("System.Description")).toBe(originalDescriptionHash);
    expect(host.getRawField("Custom.RoosterContent")).toContain("s");
    const reopenedShell = root.querySelector<HTMLElement>(".rdx-editor");
    const reopenedContentRoots = reopenedShell?.querySelectorAll<HTMLElement>(
      ':scope > [data-rdx-content-root][aria-label="Description editor"]'
    );
    expect(reopenedShell?.contentEditable).toBe("false");
    expect(reopenedContentRoots).toHaveLength(1);
    expect(reopenedContentRoots?.[0]?.contentEditable).toBe("true");
  });
});
