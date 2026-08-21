import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const roosterBoundary = vi.hoisted(() => {
  interface DomEventRecord {
    beforeDispatch: (event: Event) => void;
  }

  interface FakeEditor {
    attachDomEvent: ReturnType<typeof vi.fn>;
    contentDiv: HTMLDivElement;
    dispose: ReturnType<typeof vi.fn>;
    disposeDomEvents: ReturnType<typeof vi.fn>;
    getDOMSelection: ReturnType<typeof vi.fn>;
    getSnapshotsManager: ReturnType<typeof vi.fn>;
    restoreSnapshot: ReturnType<typeof vi.fn>;
    setDOMSelection: ReturnType<typeof vi.fn>;
    setLogicalRoot: ReturnType<typeof vi.fn>;
    snapshotsManager: { move: ReturnType<typeof vi.fn> };
    takeSnapshot: ReturnType<typeof vi.fn>;
  }

  class MarkdownPlugin {
    constructor(readonly options: unknown) {}
  }

  class TableEditPlugin {}

  const editors: FakeEditor[] = [];
  const domEventMaps: Array<Record<string, DomEventRecord>> = [];
  const failures: {
    createEditor?: unknown;
    attachDomEvent?: unknown;
    dispatchPasteBeforeAttachFailure?: boolean;
    initialHtmlRead?: unknown;
  } = {};
  const createEditor = vi.fn((contentDiv: HTMLDivElement, _plugins?: unknown[]) => {
    if (failures.createEditor) {
      throw failures.createEditor;
    }
    contentDiv.innerHTML =
      '<div style="font-family: Calibri, Arial, Helvetica, sans-serif; font-size: 11pt; color: rgb(0, 0, 0);"><br></div>';
    if (failures.initialHtmlRead) {
      let innerHtml = contentDiv.innerHTML;
      Object.defineProperty(contentDiv, "innerHTML", {
        configurable: true,
        get: () => {
          throw failures.initialHtmlRead;
        },
        set: value => {
          innerHtml = String(value);
        }
      });
      void innerHtml;
    }
    const attachedListeners: Array<[string, EventListener]> = [];
    const disposeDomEvents = vi.fn(() => {
      attachedListeners.forEach(([eventName, listener]) => {
        contentDiv.removeEventListener(eventName, listener);
      });
    });
    const snapshotsManager = { move: vi.fn(() => null as unknown) };
    const editor: FakeEditor = {
      attachDomEvent: vi.fn((eventMap: Record<string, DomEventRecord>) => {
        domEventMaps.push(eventMap);
        Object.entries(eventMap).forEach(([eventName, record]) => {
          const listener: EventListener = event => record.beforeDispatch(event);
          contentDiv.addEventListener(eventName, listener);
          attachedListeners.push([eventName, listener]);
        });
        if (failures.attachDomEvent) {
          if (failures.dispatchPasteBeforeAttachFailure) {
            eventMap.paste.beforeDispatch(new Event("paste"));
          }
          throw failures.attachDomEvent;
        }
        return disposeDomEvents;
      }),
      contentDiv,
      dispose: vi.fn(),
      disposeDomEvents,
      getDOMSelection: vi.fn(() => null),
      getSnapshotsManager: vi.fn(() => snapshotsManager),
      restoreSnapshot: vi.fn(),
      setDOMSelection: vi.fn(),
      setLogicalRoot: vi.fn(),
      snapshotsManager,
      takeSnapshot: vi.fn()
    };
    editors.push(editor);
    return editor;
  });

  return {
    MarkdownPlugin,
    TableEditPlugin,
    createEditor,
    domEventMaps,
    editors,
    failures,
    insertLink: vi.fn(),
    insertTable: vi.fn(),
    toggleBold: vi.fn(),
    toggleBullet: vi.fn(),
    toggleItalic: vi.fn(),
    toggleNumbering: vi.fn(),
    toggleUnderline: vi.fn()
  };
});

const tableMenuBoundary = vi.hoisted(() => {
  interface TableContextMenuOptions {
    editor: unknown;
    hostRoot: HTMLElement;
    onContentChanged: () => void;
    onFeatureUsed?: () => void;
  }

  const instances: TableContextMenu[] = [];
  const failedInstances: TableContextMenu[] = [];
  const failures: { constructorError?: unknown } = {};

  class TableContextMenu {
    constructor(readonly options: TableContextMenuOptions) {
      if (failures.constructorError) {
        failedInstances.push(this);
        throw failures.constructorError;
      }
      instances.push(this);
    }

    dispose = vi.fn();
    hide = vi.fn();
    open = vi.fn();
  }

  return { failedInstances, failures, instances, TableContextMenu };
});

const codeBlockBoundary = vi.hoisted(() => ({
  toggleCodeBlock: vi.fn()
}));

vi.mock("roosterjs", () => roosterBoundary);
vi.mock("../../src/control/TableContextMenu", () => tableMenuBoundary);
vi.mock("../../src/control/toggleCodeBlock", () => codeBlockBoundary);

import {
  RoosterHost,
  type EditorHost,
  type RoosterHostOptions
} from "../../src/control/RoosterHost";

function assertPublicTypes(host: RoosterHost, options: RoosterHostOptions): EditorHost {
  // @ts-expect-error Configuration is immutable after construction.
  options.enableCodeBlock = false;
  return host;
}

void assertPublicTypes;

describe("RoosterHost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    roosterBoundary.domEventMaps.length = 0;
    roosterBoundary.editors.length = 0;
    delete roosterBoundary.failures.createEditor;
    delete roosterBoundary.failures.attachDomEvent;
    delete roosterBoundary.failures.dispatchPasteBeforeAttachFailure;
    delete roosterBoundary.failures.initialHtmlRead;
    tableMenuBoundary.instances.length = 0;
    tableMenuBoundary.failedInstances.length = 0;
    delete tableMenuBoundary.failures.constructorError;
    roosterBoundary.insertLink.mockReset();
    roosterBoundary.insertTable.mockReset();
    roosterBoundary.toggleBold.mockReset();
    roosterBoundary.toggleBullet.mockReset();
    roosterBoundary.toggleItalic.mockReset();
    roosterBoundary.toggleNumbering.mockReset();
    roosterBoundary.toggleUnderline.mockReset();
    codeBlockBoundary.toggleCodeBlock.mockReset();
    document.body.replaceChildren();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("exposes fixed accessible names and semantics without changing the text-button order", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const host = new RoosterHost(root, {
      enableMarkdownAutoformat: false,
      enableCodeBlock: true
    });

    const toolbar = root.querySelector(".rdx-toolbar");
    const editor = root.querySelector(".rdx-editor");
    const status = root.querySelector(".rdx-status");
    const buttons = [...root.querySelectorAll<HTMLButtonElement>(".rdx-toolbar button")];

    expect(toolbar?.getAttribute("role")).toBe("toolbar");
    expect(toolbar?.getAttribute("aria-label")).toBe("Formatting toolbar");
    expect(editor?.getAttribute("aria-label")).toBe("Description editor");
    expect(status?.getAttribute("role")).toBe("status");
    expect(status?.getAttribute("aria-live")).toBe("polite");
    expect(status?.getAttribute("aria-label")).toBe("Editor status");
    expect(status?.textContent).toBe("Ready");
    expect(buttons.every(button => button.type === "button")).toBe(true);
    expect(buttons.map(button => button.textContent)).toEqual([
      "Bold",
      "Italic",
      "Underline",
      "Bullet",
      "Number",
      "Link",
      "Table",
      "Code",
      "Undo",
      "Redo"
    ]);

    host.dispose();
  });

  it("omits only Code when that feature is disabled", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const host = new RoosterHost(root, {
      enableMarkdownAutoformat: false,
      enableCodeBlock: false
    });

    expect(
      [...root.querySelectorAll<HTMLButtonElement>(".rdx-toolbar button")].map(
        button => button.textContent
      )
    ).toEqual([
      "Bold",
      "Italic",
      "Underline",
      "Bullet",
      "Number",
      "Link",
      "Table",
      "Undo",
      "Redo"
    ]);

    host.dispose();
  });

  it.each(["input", "keyup"])(
    "emits the latest complete HTML once for a %s event",
    eventName => {
      const { editor, host } = mountHost();
      const listener = vi.fn();
      host.onChange(listener);
      editor.innerHTML = `<p>${eventName} complete</p>`;

      editor.dispatchEvent(new Event(eventName, { bubbles: true }));

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(`<p>${eventName} complete</p>`);
      host.dispose();
    }
  );

  it("coalesces the input and keyup sequence for one edit into one latest notification", () => {
    const { editor, host } = mountHost();
    host.setHtml("<p>before</p>");
    const listener = vi.fn();
    host.onChange(listener);
    editor.innerHTML = "<p>typed</p>";

    editor.dispatchEvent(new Event("input", { bubbles: true }));
    editor.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "d" }));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith("<p>typed</p>");
    host.dispose();
  });

  it("does not emit for the first no-op keyup over Rooster's initialized DOM", () => {
    const { editor, host } = mountHost();
    const listener = vi.fn();
    host.onChange(listener);

    editor.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Shift" }));

    expect(listener).not.toHaveBeenCalled();
    host.dispose();
  });

  it("waits for native cut DOM mutation and suppresses its following input duplicate", () => {
    vi.useFakeTimers();
    const { editor, host } = mountHost();
    host.setHtml("<p>before cut</p>");
    const listener = vi.fn();
    host.onChange(listener);

    editor.dispatchEvent(new Event("cut", { bubbles: true }));
    editor.innerHTML = "<p>after cut</p>";
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    vi.runAllTimers();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith("<p>after cut</p>");
    host.dispose();
  });

  it("emits a toolbar action once after reading its completed HTML", () => {
    const { editor, host, root } = mountHost();
    const listener = vi.fn();
    host.onChange(listener);
    roosterBoundary.toggleBold.mockImplementation((fakeEditor: { contentDiv: HTMLElement }) => {
      fakeEditor.contentDiv.innerHTML = "<p><strong>formatted</strong></p>";
    });

    getToolbarButton(root, "Bold").click();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith("<p><strong>formatted</strong></p>");
    expect(editor.innerHTML).toBe("<p><strong>formatted</strong></p>");
    host.dispose();
  });

  it("inserts a 3 by 3 table and emits exactly once after the insertion", () => {
    const onFeatureUsed = vi.fn();
    const { host, root } = mountHost({ onFeatureUsed });
    const listener = vi.fn();
    host.onChange(listener);
    roosterBoundary.insertTable.mockImplementation((fakeEditor: { contentDiv: HTMLElement }) => {
      fakeEditor.contentDiv.innerHTML = "<table><tbody><tr><td>new</td></tr></tbody></table>";
    });

    getToolbarButton(root, "Table").click();

    expect(roosterBoundary.insertTable).toHaveBeenCalledWith(
      roosterBoundary.editors[0],
      3,
      3
    );
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      "<table><tbody><tr><td>new</td></tr></tbody></table>"
    );
    expect(onFeatureUsed).toHaveBeenCalledTimes(1);
    expect(onFeatureUsed).toHaveBeenCalledWith("table");
    host.dispose();
  });

  it("emits exactly once for a successful table context-menu callback", () => {
    const { editor, host } = mountHost();
    const listener = vi.fn();
    host.onChange(listener);
    editor.innerHTML = "<table><tbody><tr><td>changed</td></tr></tbody></table>";

    tableMenuBoundary.instances[0].options.onContentChanged();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      "<table><tbody><tr><td>changed</td></tr></tbody></table>"
    );
    host.dispose();
  });

  it.each([null, "", "   "])(
    "treats a %s link prompt result as a true no-op",
    promptResult => {
      const onFeatureUsed = vi.fn();
      const { host, root } = mountHost({ onFeatureUsed });
      const listener = vi.fn();
      host.onChange(listener);
      const prompt = vi.spyOn(window, "prompt").mockReturnValue(promptResult);

      getToolbarButton(root, "Link").click();

      expect(prompt).toHaveBeenCalledWith("Link URL");
      expect(roosterBoundary.insertLink).not.toHaveBeenCalled();
      expect(onFeatureUsed).not.toHaveBeenCalled();
      expect(listener).not.toHaveBeenCalled();
      host.dispose();
    }
  );

  it("trims a non-empty native link prompt before inserting and emitting once", () => {
    const { host, root } = mountHost();
    const listener = vi.fn();
    host.onChange(listener);
    vi.spyOn(window, "prompt").mockReturnValue("  https://example.test/path  ");
    roosterBoundary.insertLink.mockImplementation((fakeEditor: { contentDiv: HTMLElement }) => {
      fakeEditor.contentDiv.innerHTML = '<p><a href="https://example.test/path">linked</a></p>';
    });

    getToolbarButton(root, "Link").click();

    expect(roosterBoundary.insertLink).toHaveBeenCalledWith(
      roosterBoundary.editors[0],
      "https://example.test/path"
    );
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      '<p><a href="https://example.test/path">linked</a></p>'
    );
    host.dispose();
  });

  it.each([
    { enableMarkdownAutoformat: false, text: "# heading", expectedFeatures: [] },
    { enableMarkdownAutoformat: true, text: "ordinary prose", expectedFeatures: [] },
    { enableMarkdownAutoformat: true, text: "", expectedFeatures: [] },
    { enableMarkdownAutoformat: true, text: "# heading", expectedFeatures: ["markdown"] }
  ])(
    "reports Markdown only for matching non-empty plain text when enabled: $enableMarkdownAutoformat/$text",
    ({ enableMarkdownAutoformat, text, expectedFeatures }) => {
      vi.useFakeTimers();
      const onFeatureUsed = vi.fn();
      const { editor, host } = mountHost({ enableMarkdownAutoformat, onFeatureUsed });
      const listener = vi.fn();
      host.onChange(listener);
      const paste = new Event("paste", { bubbles: true });
      Object.defineProperty(paste, "clipboardData", {
        value: { getData: (format: string) => (format === "text/plain" ? text : "") }
      });

      editor.dispatchEvent(paste);
      editor.innerHTML = "<p>post-paste DOM</p>";
      vi.runAllTimers();

      expect(onFeatureUsed.mock.calls.map(([feature]) => feature)).toEqual(expectedFeatures);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith("<p>post-paste DOM</p>");
      host.dispose();
    }
  );

  it("constructs MarkdownPlugin only when Markdown autoformat is enabled", () => {
    const disabled = mountHost({ enableMarkdownAutoformat: false });
    const enabled = mountHost({ enableMarkdownAutoformat: true });
    const disabledPlugins = roosterBoundary.createEditor.mock.calls[0][1] ?? [];
    const enabledPlugins = roosterBoundary.createEditor.mock.calls[1][1] ?? [];

    expect(
      disabledPlugins.some(plugin => plugin instanceof roosterBoundary.MarkdownPlugin)
    ).toBe(false);
    expect(enabledPlugins.some(plugin => plugin instanceof roosterBoundary.MarkdownPlugin)).toBe(
      true
    );

    disabled.host.dispose();
    enabled.host.dispose();
  });

  it.each([
    { modifier: "ctrlKey", label: "Ctrl" },
    { modifier: "metaKey", label: "Cmd" }
  ] as const)("runs the enabled $label+Shift+8 path exactly once", ({ modifier }) => {
    const onFeatureUsed = vi.fn();
    const { editor, host } = mountHost({ enableCodeBlock: true, onFeatureUsed });
    const listener = vi.fn();
    host.onChange(listener);
    codeBlockBoundary.toggleCodeBlock.mockImplementation(
      (fakeEditor: { contentDiv: HTMLElement }) => {
        fakeEditor.contentDiv.innerHTML = "<pre>code</pre>";
      }
    );
    const shortcut = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "Digit8",
      key: "*",
      shiftKey: true,
      [modifier]: true
    });

    editor.dispatchEvent(shortcut);
    editor.dispatchEvent(
      new KeyboardEvent("keyup", {
        bubbles: true,
        code: "Digit8",
        key: "*",
        shiftKey: true,
        [modifier]: true
      })
    );

    expect(shortcut.defaultPrevented).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith("<pre>code</pre>");
    expect(onFeatureUsed).toHaveBeenCalledTimes(1);
    expect(onFeatureUsed).toHaveBeenCalledWith("codeblock");
    host.dispose();
  });

  it.each([
    { modifier: "ctrlKey", label: "Ctrl", rejection: "repeat", repeat: true, altKey: false },
    { modifier: "metaKey", label: "Cmd", rejection: "repeat", repeat: true, altKey: false },
    { modifier: "ctrlKey", label: "Ctrl", rejection: "Alt", repeat: false, altKey: true },
    { modifier: "metaKey", label: "Cmd", rejection: "Alt", repeat: false, altKey: true }
  ] as const)(
    "rejects $label+Shift+8 when $rejection is present",
    ({ modifier, repeat, altKey }) => {
      const onFeatureUsed = vi.fn();
      const { editor, host } = mountHost({ enableCodeBlock: true, onFeatureUsed });
      const listener = vi.fn();
      host.onChange(listener);
      codeBlockBoundary.toggleCodeBlock.mockImplementation(
        (fakeEditor: { contentDiv: HTMLElement }) => {
          fakeEditor.contentDiv.innerHTML = "<pre>rejected</pre>";
        }
      );
      const shortcut = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        code: "Digit8",
        key: "*",
        shiftKey: true,
        repeat,
        altKey,
        [modifier]: true
      });

      editor.dispatchEvent(shortcut);

      expect(shortcut.defaultPrevented).toBe(false);
      expect(codeBlockBoundary.toggleCodeBlock).not.toHaveBeenCalled();
      expect(onFeatureUsed).not.toHaveBeenCalled();
      expect(listener).not.toHaveBeenCalled();
      host.dispose();
    }
  );

  it("retains the key fallback when a valid shortcut has no physical code", () => {
    const onFeatureUsed = vi.fn();
    const { editor, host } = mountHost({ enableCodeBlock: true, onFeatureUsed });
    const listener = vi.fn();
    host.onChange(listener);
    codeBlockBoundary.toggleCodeBlock.mockImplementation(
      (fakeEditor: { contentDiv: HTMLElement }) => {
        fakeEditor.contentDiv.innerHTML = "<pre>fallback</pre>";
      }
    );

    const shortcut = codeShortcut({ code: "", key: "8" });
    editor.dispatchEvent(shortcut);

    expect(shortcut.defaultPrevented).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith("<pre>fallback</pre>");
    expect(onFeatureUsed).toHaveBeenCalledWith("codeblock");
    host.dispose();
  });

  it("does not run code block for disabled or unrelated shortcut paths", () => {
    const disabled = mountHost({ enableCodeBlock: false });
    const disabledListener = vi.fn();
    disabled.host.onChange(disabledListener);
    disabled.editor.dispatchEvent(codeShortcut({ code: "Digit8" }));

    const enabled = mountHost({ enableCodeBlock: true });
    const enabledListener = vi.fn();
    enabled.host.onChange(enabledListener);
    enabled.editor.dispatchEvent(codeShortcut({ code: "KeyA", key: "*" }));

    expect(codeBlockBoundary.toggleCodeBlock).not.toHaveBeenCalled();
    expect(disabledListener).not.toHaveBeenCalled();
    expect(enabledListener).not.toHaveBeenCalled();
    disabled.host.dispose();
    enabled.host.dispose();
  });

  it("does not let optional feature-observer failures suppress successful changes", () => {
    const { host, root } = mountHost({
      onFeatureUsed: () => {
        throw new Error("observer failed");
      }
    });
    const listener = vi.fn();
    host.onChange(listener);
    roosterBoundary.insertTable.mockImplementation((fakeEditor: { contentDiv: HTMLElement }) => {
      fakeEditor.contentDiv.innerHTML = "<table><tbody><tr><td>ok</td></tr></tbody></table>";
    });

    getToolbarButton(root, "Table").click();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      "<table><tbody><tr><td>ok</td></tr></tbody></table>"
    );
    host.dispose();
  });

  it("does not let one failing change listener suppress its siblings", () => {
    const { host, root } = mountHost();
    const secondListener = vi.fn();
    host.onChange(() => {
      throw new Error("listener failed");
    });
    host.onChange(secondListener);
    roosterBoundary.toggleBold.mockImplementation((fakeEditor: { contentDiv: HTMLElement }) => {
      fakeEditor.contentDiv.innerHTML = "<p><strong>still emitted</strong></p>";
    });

    getToolbarButton(root, "Bold").click();

    expect(secondListener).toHaveBeenCalledTimes(1);
    expect(secondListener).toHaveBeenCalledWith("<p><strong>still emitted</strong></p>");
    host.dispose();
  });

  it("finishes the current listener snapshot when an earlier listener removes a sibling", () => {
    const { editor, host } = mountHost();
    const calls: string[] = [];
    let unsubscribeSecond = (): void => undefined;
    host.onChange(html => {
      calls.push(`first:${html}`);
      unsubscribeSecond();
    });
    unsubscribeSecond = host.onChange(html => {
      calls.push(`second:${html}`);
    });
    editor.innerHTML = "<p>snapshot</p>";

    editor.dispatchEvent(new Event("input", { bubbles: true }));

    expect(calls).toEqual([
      "first:<p>snapshot</p>",
      "second:<p>snapshot</p>"
    ]);
    host.dispose();
  });

  it("defers listeners added during delivery until the queued later serialization", () => {
    const { editor, host } = mountHost();
    const addedListener = vi.fn();
    let added = false;
    host.onChange(() => {
      if (!added) {
        added = true;
        host.onChange(addedListener);
        editor.innerHTML = "<p>queued later</p>";
        editor.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });

    editor.innerHTML = "<p>in progress</p>";
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    expect(addedListener).toHaveBeenCalledTimes(1);
    expect(addedListener).toHaveBeenCalledWith("<p>queued later</p>");
    host.dispose();
  });

  it("serializes a reentrant empty change after every observer finishes the older HTML", () => {
    const { editor, host } = mountHost();
    const firstCalls: string[] = [];
    const secondCalls: string[] = [];
    let reentered = false;
    host.onChange(html => {
      firstCalls.push(html);
      if (!reentered) {
        reentered = true;
        editor.innerHTML = "";
        editor.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    host.onChange(html => {
      secondCalls.push(html);
    });
    editor.innerHTML = "<p>older</p>";

    editor.dispatchEvent(new Event("input", { bubbles: true }));

    expect(firstCalls).toEqual(["<p>older</p>", ""]);
    expect(secondCalls).toEqual(["<p>older</p>", ""]);
    host.dispose();
  });

  it("coalesces a reentrant bounce back to the serialization already being delivered", () => {
    const { editor, host } = mountHost();
    const firstCalls: string[] = [];
    const secondCalls: string[] = [];
    let reentered = false;
    host.onChange(html => {
      firstCalls.push(html);
      if (!reentered) {
        reentered = true;
        editor.innerHTML = "<p>intermediate</p>";
        editor.dispatchEvent(new Event("input", { bubbles: true }));
        editor.innerHTML = "<p>stable</p>";
        editor.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    host.onChange(html => {
      secondCalls.push(html);
    });
    editor.innerHTML = "<p>stable</p>";

    editor.dispatchEvent(new Event("input", { bubbles: true }));

    expect(firstCalls).toEqual(["<p>stable</p>"]);
    expect(secondCalls).toEqual(["<p>stable</p>"]);
    host.dispose();
  });

  it("drops a queued reentrant serialization when setHtml establishes a newer baseline", () => {
    const { editor, host } = mountHost();
    const firstCalls: string[] = [];
    const secondCalls: string[] = [];
    let reentered = false;
    host.onChange(html => {
      firstCalls.push(html);
      if (!reentered) {
        reentered = true;
        editor.innerHTML = "<p>queued stale</p>";
        editor.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    host.onChange(html => {
      secondCalls.push(html);
      if (html === "<p>current</p>") {
        host.setHtml("<p>authoritative</p>");
      }
    });
    editor.innerHTML = "<p>current</p>";

    editor.dispatchEvent(new Event("input", { bubbles: true }));

    expect(firstCalls).toEqual(["<p>current</p>"]);
    expect(secondCalls).toEqual(["<p>current</p>"]);
    expect(host.getHtml()).toBe("<p>authoritative</p>");
    host.dispose();
  });

  it("does not drain a queued reentrant serialization after disposal", () => {
    const { editor, host } = mountHost();
    const calls: string[] = [];
    host.onChange(html => {
      calls.push(`first:${html}`);
      editor.innerHTML = "<p>queued</p>";
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    host.onChange(html => {
      calls.push(`second:${html}`);
      host.dispose();
    });
    editor.innerHTML = "<p>current</p>";

    editor.dispatchEvent(new Event("input", { bubbles: true }));

    expect(calls).toEqual([
      "first:<p>current</p>",
      "second:<p>current</p>"
    ]);
  });

  it.each([
    { button: "Undo", step: -1, html: "<p>undo restored</p>" },
    { button: "Redo", step: 1, html: "<p>redo restored</p>" }
  ])("moves and restores the real snapshot for $button before emitting once", ({ button, step, html }) => {
    const { host, root } = mountHost();
    const fakeEditor = roosterBoundary.editors[0];
    const snapshot = { html };
    fakeEditor.snapshotsManager.move.mockReturnValue(snapshot);
    fakeEditor.restoreSnapshot.mockImplementation((nextSnapshot: { html: string }) => {
      fakeEditor.contentDiv.innerHTML = nextSnapshot.html;
    });
    const listener = vi.fn();
    host.onChange(listener);

    getToolbarButton(root, button).click();

    expect(fakeEditor.getSnapshotsManager).toHaveBeenCalledTimes(1);
    expect(fakeEditor.snapshotsManager.move).toHaveBeenCalledWith(step);
    expect(fakeEditor.restoreSnapshot).toHaveBeenCalledWith(snapshot);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(html);
    host.dispose();
  });

  it.each(["Undo", "Redo"])(
    "does not report a change when $button has no available snapshot",
    button => {
      const { host, root } = mountHost();
      const listener = vi.fn();
      host.onChange(listener);

      getToolbarButton(root, button).click();

      expect(roosterBoundary.editors[0].restoreSnapshot).not.toHaveBeenCalled();
      expect(listener).not.toHaveBeenCalled();
      host.dispose();
    }
  );

  it("cancels delayed paste work so dispose cannot produce stale notifications", () => {
    vi.useFakeTimers();
    const { editor, host } = mountHost();
    const listener = vi.fn();
    host.onChange(listener);

    editor.dispatchEvent(new Event("paste", { bubbles: true }));
    expect(vi.getTimerCount()).toBe(1);

    host.dispose();
    expect(vi.getTimerCount()).toBe(0);
    vi.runAllTimers();
    expect(listener).not.toHaveBeenCalled();
  });

  it("disposes every owned resource once and continues cleanup after partial failures", () => {
    vi.useFakeTimers();
    const { editor, host, root } = mountHost();
    const fakeEditor = roosterBoundary.editors[0];
    const menu = tableMenuBoundary.instances[0];
    const shell = root.querySelector(".rdx-shell");
    if (!(shell instanceof HTMLDivElement)) {
      throw new Error("Missing shell fixture");
    }
    const removeShell = vi.spyOn(shell, "remove");
    const detachedBoldButton = getToolbarButton(root, "Bold");
    fakeEditor.disposeDomEvents.mockImplementation(() => {
      throw new Error("DOM disposer failed");
    });
    menu.dispose.mockImplementation(() => {
      throw new Error("menu dispose failed");
    });
    fakeEditor.dispose.mockImplementation(() => {
      throw new Error("editor dispose failed");
    });
    editor.dispatchEvent(new Event("paste", { bubbles: true }));

    expect(() => host.dispose()).not.toThrow();
    expect(() => host.dispose()).not.toThrow();

    expect(fakeEditor.disposeDomEvents).toHaveBeenCalledTimes(1);
    expect(menu.dispose).toHaveBeenCalledTimes(1);
    expect(fakeEditor.dispose).toHaveBeenCalledTimes(1);
    expect(removeShell).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    detachedBoldButton.click();
    expect(roosterBoundary.toggleBold).not.toHaveBeenCalled();
  });

  it("rolls back the attached shell and every button handler when editor creation throws", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const removeListener = vi.spyOn(HTMLButtonElement.prototype, "removeEventListener");
    roosterBoundary.failures.createEditor = new Error("editor factory failed");

    expect(
      () =>
        new RoosterHost(root, {
          enableMarkdownAutoformat: false,
          enableCodeBlock: true
        })
    ).toThrow("editor factory failed");

    expect(removeListener).toHaveBeenCalledTimes(10);
    expect(root.childElementCount).toBe(0);
    expect(roosterBoundary.editors).toEqual([]);
    expect(tableMenuBoundary.instances).toEqual([]);
  });

  it("rolls back the editor without claiming a menu object whose constructor never returned", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const removeListener = vi.spyOn(HTMLButtonElement.prototype, "removeEventListener");
    tableMenuBoundary.failures.constructorError = new Error("menu factory failed");

    expect(
      () =>
        new RoosterHost(root, {
          enableMarkdownAutoformat: false,
          enableCodeBlock: false
        })
    ).toThrow("menu factory failed");

    const editor = roosterBoundary.editors[0];
    expect(editor.disposeDomEvents).not.toHaveBeenCalled();
    expect(editor.dispose).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledTimes(9);
    expect(root.childElementCount).toBe(0);
    expect(tableMenuBoundary.instances).toEqual([]);
    expect(tableMenuBoundary.failedInstances).toHaveLength(1);
    expect(tableMenuBoundary.failedInstances[0].dispose).not.toHaveBeenCalled();
  });

  it("rolls back returned menu/editor resources when DOM attachment throws before returning a disposer", () => {
    vi.useFakeTimers();
    const root = document.createElement("div");
    document.body.appendChild(root);
    const removeListener = vi.spyOn(HTMLButtonElement.prototype, "removeEventListener");
    roosterBoundary.failures.attachDomEvent = new Error("DOM attachment failed");
    roosterBoundary.failures.dispatchPasteBeforeAttachFailure = true;

    expect(
      () =>
        new RoosterHost(root, {
          enableMarkdownAutoformat: false,
          enableCodeBlock: false
        })
    ).toThrow("DOM attachment failed");

    const editor = roosterBoundary.editors[0];
    const menu = tableMenuBoundary.instances[0];
    expect(editor.disposeDomEvents).not.toHaveBeenCalled();
    expect(menu.dispose).toHaveBeenCalledTimes(1);
    expect(editor.dispose).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledTimes(9);
    expect(root.childElementCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("removes a detached shell when parent attachment itself throws", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    let removeShell: ReturnType<typeof vi.spyOn> | undefined;
    vi.spyOn(root, "replaceChildren").mockImplementation((...nodes) => {
      const shell = nodes[0];
      if (!(shell instanceof HTMLDivElement)) {
        throw new Error("Missing detached shell fixture");
      }
      removeShell = vi.spyOn(shell, "remove");
      throw new Error("parent attachment failed");
    });

    expect(
      () =>
        new RoosterHost(root, {
          enableMarkdownAutoformat: false,
          enableCodeBlock: false
        })
    ).toThrow("parent attachment failed");

    expect(removeShell).toHaveBeenCalledTimes(1);
    expect(root.childElementCount).toBe(0);
  });

  it("rolls back every returned resource when final construction state capture throws", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const removeListener = vi.spyOn(HTMLButtonElement.prototype, "removeEventListener");
    roosterBoundary.failures.initialHtmlRead = new Error("initial HTML read failed");

    expect(
      () =>
        new RoosterHost(root, {
          enableMarkdownAutoformat: false,
          enableCodeBlock: false
        })
    ).toThrow("initial HTML read failed");

    const editor = roosterBoundary.editors[0];
    const menu = tableMenuBoundary.instances[0];
    expect(editor.disposeDomEvents).toHaveBeenCalledTimes(1);
    expect(menu.dispose).toHaveBeenCalledTimes(1);
    expect(editor.dispose).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledTimes(9);
    expect(root.childElementCount).toBe(0);
  });

  it("blocks every retained event, action, timer, and feature entry after failed cleanup", () => {
    vi.useFakeTimers();
    const onFeatureUsed = vi.fn();
    const { editor, host, root } = mountHost({
      enableMarkdownAutoformat: true,
      enableCodeBlock: true,
      onFeatureUsed
    });
    const listener = vi.fn();
    host.onChange(listener);
    const fakeEditor = roosterBoundary.editors[0];
    const menu = tableMenuBoundary.instances[0];
    const staleContentCallback = menu.options.onContentChanged;
    const staleFeatureCallback = menu.options.onFeatureUsed;
    const retainedTableButton = getToolbarButton(root, "Table");
    const removeTableListener = vi
      .spyOn(retainedTableButton, "removeEventListener")
      .mockImplementation(() => {
        throw new Error("toolbar listener cleanup failed");
      });
    fakeEditor.disposeDomEvents.mockImplementation(() => {
      throw new Error("DOM disposer failed before detach");
    });

    host.dispose();

    editor.innerHTML = "<p>stale event</p>";
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    editor.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "x" }));
    editor.dispatchEvent(new Event("cut", { bubbles: true }));
    const paste = new Event("paste", { bubbles: true });
    Object.defineProperty(paste, "clipboardData", {
      value: { getData: () => "# stale markdown" }
    });
    editor.dispatchEvent(paste);
    editor.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    const shortcut = codeShortcut();
    editor.dispatchEvent(shortcut);
    staleContentCallback();
    staleFeatureCallback?.();
    retainedTableButton.click();

    expect.soft(vi.getTimerCount()).toBe(0);
    expect.soft(shortcut.defaultPrevented).toBe(false);
    expect.soft(menu.open).not.toHaveBeenCalled();
    expect.soft(codeBlockBoundary.toggleCodeBlock).not.toHaveBeenCalled();
    expect.soft(roosterBoundary.insertTable).not.toHaveBeenCalled();
    expect.soft(onFeatureUsed).not.toHaveBeenCalled();
    expect.soft(listener).not.toHaveBeenCalled();
    expect.soft(fakeEditor.disposeDomEvents).toHaveBeenCalledTimes(1);
    expect.soft(menu.dispose).toHaveBeenCalledTimes(1);
    expect.soft(fakeEditor.dispose).toHaveBeenCalledTimes(1);
    expect.soft(removeTableListener).toHaveBeenCalledTimes(1);
    vi.runAllTimers();
    expect.soft(listener).not.toHaveBeenCalled();
  });

  it("makes listener unsubscribe idempotent", () => {
    const { editor, host } = mountHost();
    const listener = vi.fn();
    const unsubscribe = host.onChange(listener);

    unsubscribe();
    unsubscribe();
    editor.innerHTML = "<p>ignored</p>";
    editor.dispatchEvent(new Event("input", { bubbles: true }));

    expect(listener).not.toHaveBeenCalled();
    host.dispose();
  });

  it("rejects listener registration and stale callbacks after disposal", () => {
    const { host } = mountHost();
    const staleTableCallback = tableMenuBoundary.instances[0].options.onContentChanged;
    host.dispose();
    const listener = vi.fn();

    const unsubscribe = host.onChange(listener);
    staleTableCallback();
    unsubscribe();
    unsubscribe();

    expect(listener).not.toHaveBeenCalled();
  });

  it("does not duplicate DOM notifications across repeated mount and dispose", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const first = new RoosterHost(root, {
      enableMarkdownAutoformat: false,
      enableCodeBlock: false
    });
    const firstListener = vi.fn();
    first.onChange(firstListener);
    first.dispose();

    const second = new RoosterHost(root, {
      enableMarkdownAutoformat: false,
      enableCodeBlock: false
    });
    const secondListener = vi.fn();
    second.onChange(secondListener);
    const secondEditor = root.querySelector(".rdx-editor");
    if (!(secondEditor instanceof HTMLDivElement)) {
      throw new Error("Missing remounted editor fixture");
    }
    secondEditor.innerHTML = "<p>one event</p>";
    secondEditor.dispatchEvent(new Event("input", { bubbles: true }));

    expect(firstListener).not.toHaveBeenCalled();
    expect(secondListener).toHaveBeenCalledTimes(1);
    expect(secondListener).toHaveBeenCalledWith("<p>one event</p>");
    second.dispose();
  });

  it("preserves readonly toolbar and editor state transitions", () => {
    const { editor, host, root } = mountHost({ enableCodeBlock: true });
    const buttons = [...root.querySelectorAll<HTMLButtonElement>(".rdx-toolbar button")];

    host.setReadOnly(true);
    expect(editor.contentEditable).toBe("false");
    expect(buttons.every(button => button.disabled)).toBe(true);

    host.setReadOnly(false);
    expect(editor.contentEditable).toBe("true");
    expect(buttons.every(button => !button.disabled)).toBe(true);
    host.dispose();
  });
});

interface MountOverrides {
  enableMarkdownAutoformat?: boolean;
  enableCodeBlock?: boolean;
  onFeatureUsed?: (feature: "table" | "markdown" | "codeblock") => void;
}

function mountHost(overrides: MountOverrides = {}): {
  editor: HTMLDivElement;
  host: RoosterHost;
  root: HTMLDivElement;
} {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const host = new RoosterHost(root, {
    enableMarkdownAutoformat: overrides.enableMarkdownAutoformat ?? false,
    enableCodeBlock: overrides.enableCodeBlock ?? false,
    onFeatureUsed: overrides.onFeatureUsed
  });
  const editor = root.querySelector(".rdx-editor");
  if (!(editor instanceof HTMLDivElement)) {
    throw new Error("Missing editor fixture");
  }
  return { editor, host, root };
}

function getToolbarButton(root: HTMLElement, label: string): HTMLButtonElement {
  const button = [...root.querySelectorAll<HTMLButtonElement>(".rdx-toolbar button")].find(
    candidate => candidate.textContent === label
  );
  if (!button) {
    throw new Error(`Missing ${label} toolbar button`);
  }
  return button;
}

function codeShortcut(overrides: { code?: string; key?: string } = {}): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    code: overrides.code ?? "Digit8",
    key: overrides.key ?? "*",
    ctrlKey: true,
    shiftKey: true
  });
}
