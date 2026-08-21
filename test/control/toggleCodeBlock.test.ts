import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor, type IEditor } from "roosterjs";

import { RoosterHost } from "../../src/control/RoosterHost";
import { toggleCodeBlock } from "../../src/control/toggleCodeBlock";

const disposables: Array<() => void> = [];

afterEach(() => {
  while (disposables.length > 0) {
    disposables.pop()?.();
  }
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("toggleCodeBlock Rooster 9.45.2 dependency contract", () => {
  it("focuses, names the format API, splits br paragraphs, wraps with Consolas, and unwraps", () => {
    const { contentDiv, editor } = createRealEditor("<p>first<br>second</p>");
    selectContents(editor, requiredElement(contentDiv, "p"));
    const focus = vi.spyOn(editor, "focus");
    const formatContentModel = vi.spyOn(editor, "formatContentModel");

    toggleCodeBlock(editor);

    expect(focus).toHaveBeenCalledTimes(1);
    expect(formatContentModel).toHaveBeenCalledTimes(1);
    expect(formatContentModel.mock.calls[0][1]).toMatchObject({
      apiName: "toggleCodeBlock"
    });
    const pre = requiredElement(contentDiv, "pre");
    expect(pre.tagName).toBe("PRE");
    expect([...pre.children].map(child => child.textContent)).toEqual(["first", "second"]);
    expect(pre.style.fontFamily).toBe("Consolas, monospace");
    expect(
      [...pre.querySelectorAll<HTMLElement>("span")].every(
        segment => segment.style.fontFamily === "Consolas, monospace"
      )
    ).toBe(true);

    toggleCodeBlock(editor);

    expect(focus).toHaveBeenCalledTimes(2);
    expect(formatContentModel).toHaveBeenCalledTimes(2);
    expect(contentDiv.querySelector("pre")).toBeNull();
    expect([...contentDiv.children].map(child => child.textContent)).toEqual([
      "first",
      "second"
    ]);
  });

  it.each([
    { modifier: "ctrlKey", label: "Ctrl" },
    { modifier: "metaKey", label: "Cmd" }
  ] as const)("runs the enabled $label+Shift+8 shortcut through the installed adapter", ({ modifier }) => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const onFeatureUsed = vi.fn();
    const host = new RoosterHost(root, {
      enableMarkdownAutoformat: false,
      enableCodeBlock: true,
      onFeatureUsed
    });
    disposables.push(() => host.dispose());
    host.setHtml("<p>shortcut code</p>");
    const editorDiv = requiredElement(root, ".rdx-editor") as HTMLDivElement;
    const installedEditor = getInstalledEditor(host);
    selectContents(installedEditor, requiredElement(editorDiv, "p"));
    const listener = vi.fn();
    host.onChange(listener);
    const event = codeShortcut(modifier);

    editorDiv.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(requiredElement(editorDiv, "pre").textContent).toBe("shortcut code");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toContain("<pre");
    expect(onFeatureUsed).toHaveBeenCalledTimes(1);
    expect(onFeatureUsed).toHaveBeenCalledWith("codeblock");
  });

  it("leaves Ctrl/Cmd+Shift+8 untouched when the code feature is disabled", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const onFeatureUsed = vi.fn();
    const host = new RoosterHost(root, {
      enableMarkdownAutoformat: false,
      enableCodeBlock: false,
      onFeatureUsed
    });
    disposables.push(() => host.dispose());
    host.setHtml("<p>plain</p>");
    const editorDiv = requiredElement(root, ".rdx-editor") as HTMLDivElement;
    const installedEditor = getInstalledEditor(host);
    selectContents(installedEditor, requiredElement(editorDiv, "p"));
    const listener = vi.fn();
    host.onChange(listener);

    const ctrlEvent = codeShortcut("ctrlKey");
    const metaEvent = codeShortcut("metaKey");
    editorDiv.dispatchEvent(ctrlEvent);
    editorDiv.dispatchEvent(metaEvent);

    expect(ctrlEvent.defaultPrevented).toBe(false);
    expect(metaEvent.defaultPrevented).toBe(false);
    expect(editorDiv.querySelector("pre")).toBeNull();
    expect(editorDiv.innerHTML).toBe("<p>plain</p>");
    expect(listener).not.toHaveBeenCalled();
    expect(onFeatureUsed).not.toHaveBeenCalled();
  });
});

function createRealEditor(html: string): { contentDiv: HTMLDivElement; editor: IEditor } {
  const contentDiv = document.createElement("div");
  contentDiv.contentEditable = "true";
  document.body.appendChild(contentDiv);
  const editor = createEditor(contentDiv);
  contentDiv.innerHTML = html;
  disposables.push(() => editor.dispose());
  return { contentDiv, editor };
}

function selectContents(editor: IEditor, element: Element): void {
  const range = document.createRange();
  range.selectNodeContents(element);
  editor.setDOMSelection({ type: "range", range, isReverted: false });
}

function getInstalledEditor(host: RoosterHost): IEditor {
  return (host as unknown as { editor: IEditor }).editor;
}

function requiredElement(root: ParentNode, selector: string): HTMLElement {
  const element = root.querySelector(selector);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Missing ${selector} fixture`);
  }
  return element;
}

function codeShortcut(modifier: "ctrlKey" | "metaKey"): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    code: "Digit8",
    key: "*",
    shiftKey: true,
    [modifier]: true
  });
}
