import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { mountTestHarness } from "../../src/test-harness";

const BKU_FIXTURE = readFileSync(
  resolve(process.cwd(), "test/fixtures/bku-template.html"),
  "utf8"
);

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("local lifecycle harness", () => {
  it("mounts every lifecycle control, independent field diagnostic, log, and narrow preview", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);

    const harness = mountTestHarness(root, { loadBku: async () => BKU_FIXTURE });

    expect(root.querySelector<HTMLInputElement>("#harness-field-name")).not.toBeNull();
    expect(root.querySelector<HTMLSelectElement>("#harness-wit")).not.toBeNull();
    expect(root.querySelector<HTMLInputElement>("#harness-read-only")).not.toBeNull();
    expect(root.querySelector<HTMLInputElement>("#harness-narrow")).not.toBeNull();
    expect(root.querySelector("[data-harness-preview]")).not.toBeNull();
    expect(root.querySelector("[data-harness-log]")).not.toBeNull();

    for (const action of [
      "load",
      "load-bku",
      "field-change",
      "save",
      "refresh",
      "reset",
      "unload",
      "reload"
    ]) {
      expect(root.querySelector(`[data-harness-action="${action}"]`)).not.toBeNull();
    }

    for (const fieldName of ["Custom.RoosterContent", "System.Description"]) {
      expect(root.querySelector(`[data-raw-field="${fieldName}"]`)).not.toBeNull();
      expect(root.querySelector(`[data-field-hash="${fieldName}"]`)).not.toBeNull();
    }

    harness.dispose();
  });

  it("edits only the custom field while the Description raw panel and hash stay exact", async () => {
    vi.useFakeTimers();
    const root = document.createElement("div");
    document.body.appendChild(root);
    const harness = mountTestHarness(root, { loadBku: async () => BKU_FIXTURE });

    await harness.runAction("load-bku");
    const descriptionRaw = root.querySelector(
      '[data-raw-field="System.Description"]'
    )?.textContent;
    const descriptionHash = root.querySelector(
      '[data-field-hash="System.Description"]'
    )?.textContent;
    const editor = root.querySelector<HTMLElement>(".rdx-editor");
    const contentRoot = editor?.querySelector<HTMLElement>("[data-rdx-content-root]");
    expect(editor).not.toBeNull();
    expect(contentRoot).not.toBeNull();
    expect(root.querySelector("[data-harness-log]")?.textContent).toContain(
      "READ Custom.RoosterContent succeeded bytes=10423"
    );

    contentRoot?.insertAdjacentText("beforeend", "ş");
    editor?.dispatchEvent(new InputEvent("input", { bubbles: true, data: "ş" }));
    await vi.advanceTimersByTimeAsync(25);
    await harness.runAction("save");

    expect(root.querySelector('[data-raw-field="Custom.RoosterContent"]')?.textContent)
      .toContain("ş");
    expect(root.querySelector('[data-raw-field="System.Description"]')?.textContent)
      .toBe(descriptionRaw);
    expect(root.querySelector('[data-field-hash="System.Description"]')?.textContent)
      .toBe(descriptionHash);
    expect(
      harness.host.writes.filter(write => write.fieldName === "System.Description")
    ).toEqual([]);
    const targetWrite = harness.host.writes.find(
      write => write.fieldName === "Custom.RoosterContent"
    );
    expect(targetWrite).toBeDefined();
    const targetWriteBytes = new TextEncoder().encode(targetWrite?.value ?? "").byteLength;
    expect(targetWriteBytes).toBeGreaterThan(targetWrite?.value.length ?? 0);
    expect(root.querySelector("[data-harness-log]")?.textContent).toContain(
      `WRITE Custom.RoosterContent succeeded bytes=${targetWriteBytes}`
    );

    const narrowToggle = root.querySelector<HTMLInputElement>("#harness-narrow");
    if (!narrowToggle) {
      throw new Error("Expected the narrow preview toggle");
    }
    narrowToggle.checked = true;
    narrowToggle.dispatchEvent(new Event("change", { bubbles: true }));
    expect(root.querySelector("[data-harness-preview]")?.classList).toContain("is-narrow");
    harness.dispose();
  });
});
