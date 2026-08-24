import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type {
  IWorkItemChangedArgs,
  IWorkItemFormService,
  IWorkItemLoadedArgs
} from "azure-devops-extension-api/WorkItemTracking";
import type { IEditor } from "roosterjs";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("azure-devops-extension-sdk", () => ({ getService: vi.fn() }));
vi.mock("azure-devops-extension-api/WorkItemTracking", () => ({
  WorkItemTrackingServiceIds: { WorkItemFormService: "work-item-form-service" }
}));

import { Sanitizer, type HtmlNormalizer } from "../../src/bridge/Sanitizer";
import { SyncEngine } from "../../src/bridge/SyncEngine";
import { WorkItemBridge } from "../../src/bridge/WorkItemBridge";
import { getControlConfig } from "../../src/config/defaults";
import {
  RoosterDescriptionControl,
  type ControllerDependencies
} from "../../src/control/RoosterDescriptionControl";
import { createReadOnlyView } from "../../src/control/ReadOnlyView";
import {
  RoosterHost,
  type EditorHost
} from "../../src/control/RoosterHost";
import { TelemetryClient } from "../../src/telemetry/TelemetryClient";

const FIELD_NAME = "System.Description";
const BKU_FIXTURE = readFileSync(
  resolve(process.cwd(), "test/fixtures/bku-template.html"),
  "utf8"
);
const LOADED_ARGS: IWorkItemLoadedArgs = {
  id: 123,
  isNew: false,
  isReadOnly: false
};
const CHANGED_ARGS: IWorkItemChangedArgs = { id: 123 };

if (!("getBoundingClientRect" in Range.prototype)) {
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(0, 0, 0, 0)
  });
}

interface NormalizerCall {
  readonly input: string;
  readonly output: string;
}

interface FieldRead {
  readonly fieldName: string;
  readonly value: string;
}

interface FieldWrite {
  readonly fieldName: string;
  readonly value: string;
}

interface StructuralInventory {
  readonly styleBlocks: number;
  readonly tables: number;
  readonly theads: number;
  readonly tbodies: number;
  readonly rows: number;
  readonly headers: number;
  readonly cells: number;
  readonly classAttributes: number;
  readonly inlineStyles: number;
  readonly rowspans: number;
  readonly colspans: number;
  readonly classInventory: readonly string[];
  readonly inlineStyleInventory: readonly string[];
}

interface RegressionFixture {
  readonly control: RoosterDescriptionControl;
  readonly bridge: WorkItemBridge;
  readonly reads: FieldRead[];
  readonly writes: FieldWrite[];
  readonly normalizerCalls: NormalizerCall[];
  readonly editorInputs: string[];
  readonly editorOutputs: string[];
  readonly hosts: RoosterHost[];
  readonly root: HTMLDivElement;
  getField(): string;
  dispose(): Promise<void>;
}

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("System.Description rendering regression", () => {
  it("keeps the full BKU structure and styling through application boundaries A-G after one character edit", async () => {
    vi.useFakeTimers();
    const fixture = await createFixture();

    try {
      await fixture.control.onLoaded(LOADED_ARGS);
      const boundaryA = requiredRead(fixture.reads, FIELD_NAME).value;
      const boundaryB = requiredBoundary(
        fixture.normalizerCalls[0]?.output,
        "B (normalized input)"
      );
      const boundaryC = requiredBoundary(
        fixture.editorInputs[0],
        "C (editor input)"
      );

      expect(boundaryA).toBe(BKU_FIXTURE);
      expect(boundaryC).toBe(boundaryB);

      typeCharacter(requiredHost(fixture), "s");
      const boundaryD = requiredBoundary(
        fixture.editorOutputs[fixture.editorOutputs.length - 1],
        "D (editor output)"
      );
      expect(boundaryD).toContain("Tanıms");

      const boundaryE = requiredBoundary(
        [...fixture.normalizerCalls]
          .reverse()
          .find(call => call.input === boundaryD)?.output,
        "E (normalized editor output)"
      );

      await vi.advanceTimersByTimeAsync(25);
      const boundaryF = requiredBoundary(
        fixture.writes[0]?.value,
        "F (System.Description write)"
      );
      expect(fixture.writes[0]?.fieldName).toBe(FIELD_NAME);
      expect(boundaryF).toBe(boundaryE);

      const boundaryG = await fixture.bridge.getFieldValue(FIELD_NAME);
      expect(boundaryG).toBe(boundaryF);

      const expectedInventory = structuralInventory(boundaryA);
      expect(expectedInventory).toMatchObject({
        styleBlocks: 1,
        tables: 6,
        theads: 4,
        tbodies: 6,
        rows: 34,
        headers: 29,
        cells: 61,
        classAttributes: 42,
        inlineStyles: 10,
        rowspans: 0,
        colspans: 0
      });

      for (const value of [
        boundaryB,
        boundaryC,
        boundaryD,
        boundaryE,
        boundaryF,
        boundaryG
      ]) {
        expect(structuralInventory(value)).toEqual(expectedInventory);
        assertRepresentativeCss(value);
      }
    } finally {
      await fixture.dispose();
    }
  });

  it("keeps unrelated BKU table headers intact when one character replaces selected text", async () => {
    vi.useFakeTimers();
    const fixture = await createFixture();

    try {
      await fixture.control.onLoaded(LOADED_ARGS);
      replaceSelectedText(requiredHost(fixture), "s");

      const editorOutput = requiredBoundary(
        fixture.editorOutputs[fixture.editorOutputs.length - 1],
        "D (editor output after selected-text replacement)"
      );
      const inventory = structuralInventory(editorOutput);
      expect(inventory).toMatchObject({
        styleBlocks: 1,
        tables: 6,
        theads: 4,
        tbodies: 6,
        rows: 34,
        headers: 29,
        cells: 61,
        classAttributes: 42
      });
      assertRepresentativeCss(editorOutput);

      await vi.advanceTimersByTimeAsync(25);
      expect(structuralInventory(requiredBoundary(
        fixture.writes[0]?.value,
        "F (System.Description write after selected-text replacement)"
      ))).toEqual(inventory);
    } finally {
      await fixture.dispose();
    }
  });

  it("restores and persists the exact pre-edit BKU structure after Ctrl+Z", async () => {
    vi.useFakeTimers();
    const fixture = await createFixture();

    try {
      await fixture.control.onLoaded(LOADED_ARGS);
      const initialCanonical = requiredHost(fixture).getHtml();

      typeCharacter(requiredHost(fixture), "s");
      await vi.advanceTimersByTimeAsync(25);
      expect(fixture.writes).toHaveLength(1);
      expect(fixture.writes[0]?.value).not.toBe(initialCanonical);

      undoWithKeyboard(requiredHost(fixture));
      await fixture.control.onSaved(CHANGED_ARGS);

      expect(requiredHost(fixture).getHtml()).toBe(initialCanonical);
      expect(fixture.writes).toHaveLength(2);
      expect(fixture.writes[1]).toEqual({
        fieldName: FIELD_NAME,
        value: initialCanonical
      });
      expect(fixture.getField()).toBe(initialCanonical);

      await fixture.control.onRefreshed(CHANGED_ARGS);
      expect(requiredHost(fixture).getHtml()).toBe(initialCanonical);
      expect(fixture.getField()).toBe(initialCanonical);

      await fixture.control.onUnloaded(CHANGED_ARGS);
      await fixture.control.onLoaded(LOADED_ARGS);

      expect(fixture.hosts).toHaveLength(2);
      expect(requiredHost(fixture).getHtml()).toBe(initialCanonical);
      expect(structuralInventory(fixture.getField())).toMatchObject({
        styleBlocks: 1,
        tables: 6,
        theads: 4,
        tbodies: 6,
        rows: 34,
        headers: 29,
        cells: 61
      });
      assertRepresentativeCss(fixture.getField());
    } finally {
      await fixture.dispose();
    }
  });
});

async function createFixture(): Promise<RegressionFixture> {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const fields = new Map<string, string>([
    ["System.WorkItemType", "SRS"],
    [FIELD_NAME, BKU_FIXTURE]
  ]);
  const reads: FieldRead[] = [];
  const writes: FieldWrite[] = [];
  const service = {
    getFieldValue: async (fieldName: string): Promise<object> => {
      const value = fields.get(fieldName) ?? "";
      reads.push({ fieldName, value });
      return value as unknown as object;
    },
    setFieldValue: async (fieldName: string, value: object): Promise<boolean> => {
      const serialized = String(value);
      writes.push({ fieldName, value: serialized });
      fields.set(fieldName, serialized);
      return true;
    }
  } satisfies Pick<IWorkItemFormService, "getFieldValue" | "setFieldValue">;
  const bridge = await WorkItemBridge.create(
    async () => service as unknown as IWorkItemFormService
  );
  const sanitizer = new Sanitizer();
  const normalizerCalls: NormalizerCall[] = [];
  const normalizer: HtmlNormalizer = {
    normalizeHtml: value => {
      const input = value ?? "";
      const output = sanitizer.normalizeHtml(input);
      normalizerCalls.push({ input, output });
      return output;
    }
  };
  const editorInputs: string[] = [];
  const editorOutputs: string[] = [];
  const hosts: RoosterHost[] = [];
  const dependencies: ControllerDependencies = {
    bridge,
    normalizer,
    telemetry: new TelemetryClient({
      extensionVersion: "test",
      hostType: "Unknown",
      info: () => undefined
    }),
    createEditor: (target, options) => {
      const host = new RoosterHost(target, options);
      hosts.push(host);
      return recordingHost(host, editorInputs, editorOutputs);
    },
    createReadOnlyView,
    createSync: options => new SyncEngine(options),
    now: () => new Date("2026-08-24T12:00:00.000Z")
  };
  const config = getControlConfig({
    witInputs: {
      FieldName: FIELD_NAME,
      EnabledWits: "SRS",
      DebounceMs: "25",
      EnableMarkdownAutoformat: "true",
      EnableCodeBlock: "true"
    }
  });
  const control = new RoosterDescriptionControl(root, config, dependencies);
  let disposed = false;

  return {
    control,
    bridge,
    reads,
    writes,
    normalizerCalls,
    editorInputs,
    editorOutputs,
    hosts,
    root,
    getField: () => fields.get(FIELD_NAME) ?? "",
    dispose: async () => {
      if (!disposed) {
        disposed = true;
        await control.onUnloaded(CHANGED_ARGS);
      }
      root.remove();
    }
  };
}

function recordingHost(
  host: RoosterHost,
  inputs: string[],
  outputs: string[]
): EditorHost {
  return {
    onChange: listener =>
      host.onChange(value => {
        outputs.push(value);
        listener(value);
      }),
    setHtml: value => {
      inputs.push(value);
      host.setHtml(value);
    },
    getHtml: () => host.getHtml(),
    setReadOnly: value => host.setReadOnly(value),
    setStatus: value => host.setStatus(value),
    dispose: () => host.dispose()
  };
}

function typeCharacter(host: RoosterHost, character: string): void {
  const editor = installedEditor(host);
  const editorElement = requiredElement<HTMLDivElement>(
    document,
    ".rdx-editor"
  );
  const canonicalRoot = requiredElement<HTMLDivElement>(
    editorElement,
    ":scope > [data-rdx-content-root]"
  );
  const target = requiredElement<HTMLElement>(canonicalRoot, ".brick.heading");
  const text = target.firstChild;
  if (!(text instanceof Text)) {
    throw new Error("Expected the BKU heading to contain a text node");
  }

  const range = document.createRange();
  range.setStart(text, text.data.length);
  range.collapse(true);
  editor.setDOMSelection({ type: "range", range, isReverted: false });

  canonicalRoot.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: character })
  );
  canonicalRoot.dispatchEvent(
    new KeyboardEvent("keypress", { bubbles: true, cancelable: true, key: character })
  );
  const insertionOffset = text.data.length;
  text.insertData(insertionOffset, character);
  const changedRange = document.createRange();
  changedRange.setStart(text, insertionOffset + character.length);
  changedRange.collapse(true);
  editor.setDOMSelection({ type: "range", range: changedRange, isReverted: false });
  canonicalRoot.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      cancelable: false,
      data: character,
      inputType: "insertText"
    })
  );
  canonicalRoot.dispatchEvent(
    new KeyboardEvent("keyup", { bubbles: true, cancelable: true, key: character })
  );
}

function replaceSelectedText(host: RoosterHost, replacement: string): void {
  const editor = installedEditor(host);
  const editorElement = requiredElement<HTMLDivElement>(document, ".rdx-editor");
  const canonicalRoot = requiredElement<HTMLDivElement>(
    editorElement,
    ":scope > [data-rdx-content-root]"
  );
  const target = requiredElement<HTMLElement>(canonicalRoot, ".brick.heading");
  const selectedRange = document.createRange();
  selectedRange.selectNodeContents(target);
  editor.setDOMSelection({ type: "range", range: selectedRange, isReverted: false });

  canonicalRoot.dispatchEvent(
    new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: replacement
    })
  );

  const browserSelection = editor.getDOMSelection();
  if (browserSelection?.type !== "range") {
    throw new Error("Expected a range selection after Rooster keyboard handling");
  }
  browserSelection.range.deleteContents();
  const text = document.createTextNode(replacement);
  browserSelection.range.insertNode(text);
  const collapsedRange = document.createRange();
  collapsedRange.setStartAfter(text);
  collapsedRange.collapse(true);
  editor.setDOMSelection({
    type: "range",
    range: collapsedRange,
    isReverted: false
  });
  canonicalRoot.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      data: replacement,
      inputType: "insertText"
    })
  );
  canonicalRoot.dispatchEvent(
    new KeyboardEvent("keyup", {
      bubbles: true,
      cancelable: true,
      key: replacement
    })
  );
}

function undoWithKeyboard(host: RoosterHost): void {
  const editor = installedEditor(host);
  const editorElement = requiredElement<HTMLDivElement>(document, ".rdx-editor");
  const canonicalRoot = requiredElement<HTMLDivElement>(
    editorElement,
    ":scope > [data-rdx-content-root]"
  );
  const isMac = editor.getEnvironment().isMac;
  const keydown = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    code: "KeyZ",
    key: "z",
    ctrlKey: !isMac,
    metaKey: isMac
  });
  Object.defineProperties(keydown, {
    keyCode: { value: 90 },
    which: { value: 90 }
  });
  canonicalRoot.dispatchEvent(keydown);
  expect(keydown.defaultPrevented).toBe(true);

  const keyup = new KeyboardEvent("keyup", {
    bubbles: true,
    cancelable: true,
    code: "KeyZ",
    key: "z",
    ctrlKey: !isMac,
    metaKey: isMac
  });
  Object.defineProperties(keyup, {
    keyCode: { value: 90 },
    which: { value: 90 }
  });
  requiredElement<HTMLDivElement>(
    document,
    ".rdx-editor > [data-rdx-content-root]"
  ).dispatchEvent(keyup);
}

function structuralInventory(html: string): StructuralInventory {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const elements = [...parsed.body.querySelectorAll("*")];

  return {
    styleBlocks: parsed.querySelectorAll("style").length,
    tables: parsed.querySelectorAll("table").length,
    theads: parsed.querySelectorAll("thead").length,
    tbodies: parsed.querySelectorAll("tbody").length,
    rows: parsed.querySelectorAll("tr").length,
    headers: parsed.querySelectorAll("th").length,
    cells: parsed.querySelectorAll("td").length,
    classAttributes: parsed.querySelectorAll("[class]").length,
    inlineStyles: parsed.querySelectorAll("[style]").length,
    rowspans: parsed.querySelectorAll("[rowspan]").length,
    colspans: parsed.querySelectorAll("[colspan]").length,
    classInventory: elements
      .filter(element => element.hasAttribute("class"))
      .map(
        element =>
          `${element.tagName}:${[...element.classList].join(" ")}`
      )
      .sort(),
    inlineStyleInventory: elements
      .filter(element => element.hasAttribute("style"))
      .map(
        element =>
          `${element.tagName}:${(element as HTMLElement).style.cssText}`
      )
      .sort()
  };
}

function assertRepresentativeCss(html: string): void {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const stylesheet = parsed.querySelector("style")?.textContent ?? "";

  for (const selector of [
    ".pdf_table",
    ".heading",
    ".big_heading",
    ".title",
    ".main_pdf_cont"
  ]) {
    expect(stylesheet).toContain(selector);
  }
  for (const property of [
    "border:",
    "font-family:",
    "font-size:",
    "font-weight:",
    "color:",
    "background-color:",
    "width:",
    "padding:"
  ]) {
    expect(stylesheet).toContain(property);
  }
}

function requiredRead(reads: readonly FieldRead[], fieldName: string): FieldRead {
  const read = reads.find(entry => entry.fieldName === fieldName);
  if (!read) {
    throw new Error(`Expected a read of ${fieldName}`);
  }
  return read;
}

function requiredBoundary(
  value: string | undefined,
  boundary: string
): string {
  if (value === undefined) {
    throw new Error(`Expected a value at boundary ${boundary}`);
  }
  return value;
}

function requiredHost(fixture: RegressionFixture): RoosterHost {
  const host = fixture.hosts[fixture.hosts.length - 1];
  if (!host) {
    throw new Error("Expected an active RoosterHost");
  }
  return host;
}

function installedEditor(host: RoosterHost): IEditor {
  return (host as unknown as { editor: IEditor }).editor;
}

function requiredElement<TElement extends Element>(
  root: ParentNode,
  selector: string
): TElement {
  const element = root.querySelector<TElement>(selector);
  if (!element) {
    throw new Error(`Expected element matching ${selector}`);
  }
  return element;
}
