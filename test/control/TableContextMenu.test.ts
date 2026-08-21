import { afterEach, describe, expect, it, vi } from "vitest";
import type { DOMSelection, IEditor } from "roosterjs-content-model-types";

const roosterApi = vi.hoisted(() => ({
  editTable: vi.fn(),
  setTableCellShade: vi.fn()
}));

vi.mock("roosterjs-content-model-api", () => roosterApi);

import { TableContextMenu } from "../../src/control/TableContextMenu";

afterEach(() => {
  document.body.replaceChildren();
  roosterApi.editTable.mockReset();
  roosterApi.setTableCellShade.mockReset();
  vi.restoreAllMocks();
});

function mountTable(html = "<table><tr><td>One</td></tr></table>"): {
  root: HTMLDivElement;
  table: HTMLTableElement;
  cell: HTMLTableCellElement;
} {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.appendChild(root);
  const table = root.querySelector("table");
  const cell = root.querySelector("td,th");

  if (!(table instanceof HTMLTableElement) || !(cell instanceof HTMLTableCellElement)) {
    throw new Error("Missing table fixture");
  }

  return { root, table, cell };
}

function createEditor(table: HTMLTableElement, selection = { firstRow: 0, lastRow: 0, firstColumn: 0, lastColumn: 0 }): IEditor {
  let currentSelection: DOMSelection | null = { type: "table", table, ...selection };
  return {
    getDOMSelection: () => currentSelection,
    setDOMSelection: (nextSelection: DOMSelection | null) => {
      currentSelection = nextSelection;
    }
  } as unknown as IEditor;
}

function contextEvent(target: HTMLTableCellElement, clientX = 40, clientY = 40): MouseEvent {
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX, clientY });
  Object.defineProperty(event, "target", { value: target });
  return event;
}

function button(id: string): HTMLButtonElement {
  const element = document.querySelector(`[data-command-id="${id}"]`);
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error(`Missing ${id} command`);
  }
  return element;
}

function choiceGroup(label: string): HTMLElement {
  const element = document.querySelector(`[role="group"][aria-label="${label}"]`);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Missing ${label} choice group`);
  }
  return element;
}

function press(key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  document.dispatchEvent(event);
  return event;
}

describe("TableContextMenu", () => {
  it.each([
    ["after body append", "document", "pointerdown", false],
    ["after pointerdown acquisition", "document", "keydown", false],
    ["after keydown acquisition", "window", "resize", false],
    ["after resize acquisition", "window", "blur", false],
    ["after blur side-effect acquisition", "window", "blur", true]
  ] as const)(
    "rolls back menu and all possibly acquired global listeners %s",
    (_label, failureTarget, failureType, sideEffectThenThrow) => {
      const { root, table } = mountTable();
      const failure = new Error("original listener acquisition failure");
      const acquisitions: Array<{
        target: "document" | "window";
        type: string;
        listener: EventListenerOrEventListenerObject;
        options: boolean | AddEventListenerOptions | undefined;
      }> = [];
      const addDocumentListener = document.addEventListener.bind(document);
      const addWindowListener = window.addEventListener.bind(window);
      const removeDocumentListener = vi.spyOn(document, "removeEventListener");
      const removeWindowListener = vi.spyOn(window, "removeEventListener");
      vi.spyOn(document, "addEventListener").mockImplementation(
        (type, listener, options) => {
          if (type === "pointerdown" || type === "keydown") {
            acquisitions.push({ target: "document", type, listener, options });
            if (failureTarget === "document" && type === failureType) {
              if (sideEffectThenThrow) {
                addDocumentListener(type, listener, options);
              }
              throw failure;
            }
          }
          addDocumentListener(type, listener, options);
        }
      );
      vi.spyOn(window, "addEventListener").mockImplementation(
        (type, listener, options) => {
          if (type === "resize" || type === "blur") {
            acquisitions.push({ target: "window", type, listener, options });
            if (failureTarget === "window" && type === failureType) {
              if (sideEffectThenThrow) {
                addWindowListener(type, listener, options);
              }
              throw failure;
            }
          }
          addWindowListener(type, listener, options);
        }
      );

      let received: unknown;
      try {
        new TableContextMenu({
          editor: createEditor(table),
          hostRoot: root,
          onContentChanged: () => undefined
        });
      } catch (error) {
        received = error;
      }

      expect(received).toBe(failure);
      expect(document.querySelector(".rdx-context-menu")).toBeNull();
      for (const acquisition of acquisitions) {
        const removeListener =
          acquisition.target === "document"
            ? removeDocumentListener
            : removeWindowListener;
        if (acquisition.options === undefined) {
          expect(removeListener).toHaveBeenCalledWith(
            acquisition.type,
            acquisition.listener
          );
        } else {
          expect(removeListener).toHaveBeenCalledWith(
            acquisition.type,
            acquisition.listener,
            acquisition.options
          );
        }
      }
      expect(
        removeDocumentListener.mock.calls
          .filter(([type]) => type === "pointerdown" || type === "keydown")
          .map(([type]) => type)
      ).toEqual(["pointerdown", "keydown"]);
      expect(
        removeWindowListener.mock.calls
          .filter(([type]) => type === "resize" || type === "blur")
          .map(([type]) => type)
      ).toEqual(["resize", "blur"]);
    }
  );

  it("retries a listener removal that throws before taking effect", () => {
    const { root, table } = mountTable();
    const menu = new TableContextMenu({
      editor: createEditor(table),
      hostRoot: root,
      onContentChanged: () => undefined
    });
    const menuNode = document.querySelector(".rdx-context-menu");
    if (!(menuNode instanceof HTMLDivElement)) {
      throw new Error("Missing menu fixture");
    }
    const removeMenu = vi.spyOn(menuNode, "remove");
    const removeDocumentListener = document.removeEventListener.bind(document);
    const removeWindowListener = window.removeEventListener.bind(window);
    const documentRemovals: string[] = [];
    const windowRemovals: string[] = [];
    let threw = false;
    vi.spyOn(document, "removeEventListener").mockImplementation(
      (type, listener, options) => {
        if (type === "pointerdown" || type === "keydown") {
          documentRemovals.push(type);
        }
        if (type === "pointerdown" && !threw) {
          threw = true;
          throw new Error("listener removal failed");
        }
        removeDocumentListener(type, listener, options);
      }
    );
    vi.spyOn(window, "removeEventListener").mockImplementation(
      (type, listener, options) => {
        if (type === "resize" || type === "blur") {
          windowRemovals.push(type);
        }
        removeWindowListener(type, listener, options);
      }
    );

    expect(() => menu.dispose()).not.toThrow();

    expect(documentRemovals).toEqual(["pointerdown", "keydown", "pointerdown"]);
    expect(windowRemovals).toEqual(["resize", "blur"]);
    expect(removeMenu).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".rdx-context-menu")).toBeNull();
  });

  it("retries transient listener cleanup while preserving the constructor failure", () => {
    const { root, table } = mountTable();
    const constructionFailure = new Error("keydown acquisition failed");
    const addDocumentListener = document.addEventListener.bind(document);
    const removeDocumentListener = document.removeEventListener.bind(document);
    let pointerRemovalAttempts = 0;
    vi.spyOn(document, "addEventListener").mockImplementation(
      (type, listener, options) => {
        if (type === "keydown") {
          throw constructionFailure;
        }
        addDocumentListener(type, listener, options);
      }
    );
    vi.spyOn(document, "removeEventListener").mockImplementation(
      (type, listener, options) => {
        if (type === "pointerdown") {
          pointerRemovalAttempts += 1;
          if (pointerRemovalAttempts === 1) {
            throw new Error("transient listener cleanup failure");
          }
        }
        removeDocumentListener(type, listener, options);
      }
    );

    expect(
      () =>
        new TableContextMenu({
          editor: createEditor(table),
          hostRoot: root,
          onContentChanged: () => undefined
        })
    ).toThrow(constructionFailure);

    expect(pointerRemovalAttempts).toBe(2);
    expect(document.querySelector(".rdx-context-menu")).toBeNull();
  });

  it("exposes disabled and active menu states to assistive technology", () => {
    const { root, table, cell } = mountTable(
      '<table style="margin-right:auto"><tr><td style="text-align:center;vertical-align:middle;background:#d9ead3">One</td></tr></table>'
    );
    const menu = new TableContextMenu({ editor: createEditor(table), hostRoot: root, onContentChanged: () => undefined });

    expect(menu.open(contextEvent(cell))).toBe(true);
    expect(button("deleteRow").disabled).toBe(true);
    expect(button("deleteRow").getAttribute("aria-disabled")).toBe("true");
    expect(button("deleteColumn").disabled).toBe(true);
    expect(button("mergeCells").disabled).toBe(true);
    expect(button("alignFullWidth").disabled).toBe(true);
    expect(button("alignCellCenter").classList.contains("is-active")).toBe(true);
    expect(button("alignCellCenter").getAttribute("role")).toBe("menuitemradio");
    expect(button("alignCellCenter").getAttribute("aria-checked")).toBe("true");
    expect(button("alignCellMiddle").getAttribute("aria-checked")).toBe("true");
    expect(button("alignLeft").getAttribute("aria-checked")).toBe("true");
    expect(button("alignCellLeft").getAttribute("aria-checked")).toBe("false");
    expect(button("shadeGreen").getAttribute("role")).toBe("menuitemradio");
    expect(button("shadeGreen").getAttribute("aria-checked")).toBe("true");
    expect(button("insertAbove").getAttribute("role")).toBe("menuitem");
    expect(button("insertAbove").hasAttribute("aria-pressed")).toBe(false);
    expect(button("insertAbove").hasAttribute("aria-checked")).toBe(false);

    menu.dispose();
  });

  it("marks None as the checked shading choice for an unshaded cell", () => {
    const { root, table, cell } = mountTable();
    const menu = new TableContextMenu({ editor: createEditor(table), hostRoot: root, onContentChanged: () => undefined });

    menu.open(contextEvent(cell));

    expect(button("shadeNone").classList.contains("is-active")).toBe(true);
    expect(button("shadeNone").getAttribute("role")).toBe("menuitemradio");
    expect(button("shadeNone").getAttribute("aria-checked")).toBe("true");
    expect(button("shadeYellow").getAttribute("aria-checked")).toBe("false");

    menu.dispose();
  });

  it("checks uniform multi-cell alignment and shading states", () => {
    const { root, table, cell } = mountTable(
      '<table style="margin-left:auto;margin-right:auto"><tr>' +
        '<td style="text-align:center;vertical-align:middle;background:#d9ead3">A</td>' +
        '<td style="text-align:center;vertical-align:middle;background:#d9ead3">B</td>' +
        "</tr></table>"
    );
    const menu = new TableContextMenu({
      editor: createEditor(table, {
        firstRow: 0,
        lastRow: 0,
        firstColumn: 0,
        lastColumn: 1
      }),
      hostRoot: root,
      onContentChanged: () => undefined
    });

    menu.open(contextEvent(cell));

    expect(button("alignCellCenter").getAttribute("aria-checked")).toBe("true");
    expect(button("alignCellMiddle").getAttribute("aria-checked")).toBe("true");
    expect(button("shadeGreen").getAttribute("aria-checked")).toBe("true");
    expect(button("alignCenter").getAttribute("aria-checked")).toBe("true");

    table.querySelectorAll<HTMLTableCellElement>("td").forEach(selectedCell => {
      selectedCell.style.background = "";
    });
    menu.open(contextEvent(cell));

    expect(button("shadeNone").getAttribute("aria-checked")).toBe("true");
    expect(button("shadeGreen").getAttribute("aria-checked")).toBe("false");

    menu.dispose();
  });

  it("leaves every cell choice unchecked for heterogeneous multi-cell state", () => {
    const { root, table, cell } = mountTable(
      '<table style="margin-left:auto;margin-right:auto"><tr>' +
        '<td style="text-align:center;vertical-align:middle;background:#d9ead3">A</td>' +
        '<td style="text-align:right;vertical-align:bottom;background:#fff2cc">B</td>' +
        "</tr></table>"
    );
    const menu = new TableContextMenu({
      editor: createEditor(table, {
        firstRow: 0,
        lastRow: 0,
        firstColumn: 0,
        lastColumn: 1
      }),
      hostRoot: root,
      onContentChanged: () => undefined
    });

    menu.open(contextEvent(cell));

    for (const id of [
      "alignCellLeft",
      "alignCellCenter",
      "alignCellRight",
      "alignCellTop",
      "alignCellMiddle",
      "alignCellBottom",
      "shadeNone",
      "shadeYellow",
      "shadeGreen",
      "shadeBlue",
      "shadeGray"
    ]) {
      expect(button(id).getAttribute("aria-checked"), id).toBe("false");
      expect(button(id).classList.contains("is-active"), id).toBe(false);
    }
    expect(button("alignCenter").getAttribute("aria-checked")).toBe("true");

    menu.dispose();
  });

  it("renders independent labelled radio groups without changing flat menu order", () => {
    const { root, table, cell } = mountTable(
      '<table style="margin-right:auto"><tr><td style="text-align:center;vertical-align:middle;background:#d9ead3">One</td></tr></table>'
    );
    const menu = new TableContextMenu({ editor: createEditor(table), hostRoot: root, onContentChanged: () => undefined });

    menu.open(contextEvent(cell));

    const groups = [
      ["Cell horizontal alignment", ["alignCellLeft", "alignCellCenter", "alignCellRight"]],
      ["Cell vertical alignment", ["alignCellTop", "alignCellMiddle", "alignCellBottom"]],
      ["Table alignment", ["alignLeft", "alignCenter", "alignRight", "alignFullWidth"]],
      ["Cell shading", ["shadeNone", "shadeYellow", "shadeGreen", "shadeBlue", "shadeGray"]]
    ] as const;
    for (const [label, ids] of groups) {
      const group = choiceGroup(label);
      expect([...group.querySelectorAll<HTMLButtonElement>("button")].map(item => item.dataset.commandId)).toEqual(ids);
      expect([...group.querySelectorAll<HTMLButtonElement>('[aria-checked="true"]')]).toHaveLength(1);
    }
    expect(button("alignFullWidth").getAttribute("role")).toBe("menuitemradio");
    expect(button("alignFullWidth").disabled).toBe(true);
    expect(button("alignFullWidth").getAttribute("aria-checked")).toBe("false");
    expect([...document.querySelectorAll<HTMLButtonElement>(".rdx-context-button:not(:disabled)")].map(item => item.dataset.commandId)).toEqual([
      "insertAbove",
      "insertBelow",
      "insertLeft",
      "insertRight",
      "deleteTable",
      "splitHorizontally",
      "splitVertically",
      "alignCellLeft",
      "alignCellCenter",
      "alignCellRight",
      "alignCellTop",
      "alignCellMiddle",
      "alignCellBottom",
      "alignLeft",
      "alignCenter",
      "alignRight",
      "shadeNone",
      "shadeYellow",
      "shadeGreen",
      "shadeBlue",
      "shadeGray"
    ]);

    menu.dispose();
  });

  it("preserves a valid same-table selection when the clicked cell is a selected member", () => {
    const { root, table } = mountTable(
      "<table><tr><td>A</td><td>B</td><td>C</td></tr></table>"
    );
    const cells = table.querySelectorAll<HTMLTableCellElement>("td");
    const editor = createEditor(table, {
      firstRow: 0,
      lastRow: 0,
      firstColumn: 0,
      lastColumn: 1
    });
    const menu = new TableContextMenu({
      editor,
      hostRoot: root,
      onContentChanged: () => undefined
    });

    expect(menu.open(contextEvent(cells[1]))).toBe(true);
    expect(editor.getDOMSelection()?.type).toBe("table");
    expect(button("mergeCells").disabled).toBe(false);

    menu.dispose();
  });

  it("keeps preserved large-selection analysis within a single-snapshot style-read budget", () => {
    const rows = Array.from({ length: 10 }, (_, rowIndex) =>
      "<tr>" +
      Array.from(
        { length: 10 },
        (_, columnIndex) =>
          `<td style="text-align:center;vertical-align:middle;background:#d9ead3">${rowIndex}-${columnIndex}</td>`
      ).join("") +
      "</tr>"
    ).join("");
    const { root, table } = mountTable(`<table>${rows}</table>`);
    const cells = table.querySelectorAll<HTMLTableCellElement>("td");
    const editor = createEditor(table, {
      firstRow: 0,
      lastRow: 9,
      firstColumn: 0,
      lastColumn: 9
    });
    const menu = new TableContextMenu({
      editor,
      hostRoot: root,
      onContentChanged: () => undefined
    });
    const getComputedStyle = window.getComputedStyle.bind(window);
    let computedStyleReads = 0;
    vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudoElement) => {
      computedStyleReads += 1;
      return getComputedStyle(element, pseudoElement);
    });

    expect(menu.open(contextEvent(cells[55]))).toBe(true);

    expect(editor.getDOMSelection()?.type).toBe("table");
    expect(button("mergeCells").disabled).toBe(false);
    expect(button("alignCellCenter").getAttribute("aria-checked")).toBe("true");
    expect(button("alignCellMiddle").getAttribute("aria-checked")).toBe("true");
    expect(button("shadeGreen").getAttribute("aria-checked")).toBe("true");
    expect(computedStyleReads).toBeLessThanOrEqual(cells.length * 5);

    menu.dispose();
  });

  it("collapses a same-table selection for an outside click before targeting an operation", () => {
    const { root, table } = mountTable(
      "<table><tr><td>A</td><td>B</td><td>C</td></tr></table>"
    );
    const cells = table.querySelectorAll<HTMLTableCellElement>("td");
    const editor = createEditor(table, {
      firstRow: 0,
      lastRow: 0,
      firstColumn: 0,
      lastColumn: 1
    });
    let operationTarget: HTMLTableCellElement | null = null;
    roosterApi.editTable.mockImplementation((receivedEditor: IEditor) => {
      const selection = receivedEditor.getDOMSelection();
      if (selection?.type === "range") {
        operationTarget =
          selection.range.startContainer instanceof Element
            ? selection.range.startContainer.closest("td,th")
            : selection.range.startContainer.parentElement?.closest("td,th") ?? null;
      }
    });
    const menu = new TableContextMenu({
      editor,
      hostRoot: root,
      onContentChanged: () => undefined
    });

    expect(menu.open(contextEvent(cells[2]))).toBe(true);
    expect(editor.getDOMSelection()?.type).toBe("range");
    expect(button("mergeCells").disabled).toBe(true);
    button("insertBelow").click();

    expect(roosterApi.editTable).toHaveBeenCalledWith(editor, "insertBelow");
    expect(operationTarget).toBe(cells[2]);

    menu.dispose();
  });

  it("recognizes membership through reversed table-selection bounds", () => {
    const { root, table } = mountTable(
      "<table><tr><td>A</td><td>B</td><td>C</td></tr></table>"
    );
    const cells = table.querySelectorAll<HTMLTableCellElement>("td");
    const editor = createEditor(table, {
      firstRow: 0,
      lastRow: 0,
      firstColumn: 1,
      lastColumn: 0
    });
    const menu = new TableContextMenu({
      editor,
      hostRoot: root,
      onContentChanged: () => undefined
    });

    expect(menu.open(contextEvent(cells[0]))).toBe(true);
    expect(editor.getDOMSelection()?.type).toBe("table");
    expect(button("mergeCells").disabled).toBe(false);

    menu.dispose();
  });

  it("preserves a selected merged physical cell without enabling an invalid merge", () => {
    const { root, table, cell } = mountTable(
      '<table><tr><td colspan="2">Merged</td><td>Outside</td></tr></table>'
    );
    const editor = createEditor(table, {
      firstRow: 0,
      lastRow: 0,
      firstColumn: 0,
      lastColumn: 1
    });
    const menu = new TableContextMenu({
      editor,
      hostRoot: root,
      onContentChanged: () => undefined
    });

    expect(menu.open(contextEvent(cell))).toBe(true);
    expect(editor.getDOMSelection()?.type).toBe("table");
    expect(button("mergeCells").disabled).toBe(true);

    menu.dispose();
  });

  it("collapses invalid same-table bounds to the clicked cell", () => {
    const { root, table, cell } = mountTable(
      "<table><tr><td>A</td><td>B</td></tr></table>"
    );
    const editor = createEditor(table, {
      firstRow: 0,
      lastRow: 0,
      firstColumn: 0,
      lastColumn: 99
    });
    const menu = new TableContextMenu({
      editor,
      hostRoot: root,
      onContentChanged: () => undefined
    });

    expect(menu.open(contextEvent(cell))).toBe(true);
    expect(editor.getDOMSelection()?.type).toBe("range");
    expect(button("mergeCells").disabled).toBe(true);

    menu.dispose();
  });

  it("uses Rooster table APIs and notifies only after successful commands", () => {
    const { root, table, cell } = mountTable(
      "<table><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>"
    );
    const onContentChanged = vi.fn();
    const onFeatureUsed = vi.fn();
    const menu = new TableContextMenu({
      editor: createEditor(table, { firstRow: 0, lastRow: 1, firstColumn: 0, lastColumn: 1 }),
      hostRoot: root,
      onContentChanged,
      onFeatureUsed
    });

    menu.open(contextEvent(cell));
    expect(button("mergeCells").disabled).toBe(false);
    button("mergeCells").click();
    expect(roosterApi.editTable).toHaveBeenCalledWith(expect.anything(), "mergeCells");
    expect(onContentChanged).toHaveBeenCalledTimes(1);
    expect(onFeatureUsed).toHaveBeenCalledTimes(1);

    menu.open(contextEvent(cell));
    button("shadeBlue").click();
    expect(roosterApi.setTableCellShade).toHaveBeenCalledWith(expect.anything(), "#d0e0ff");
    expect(onContentChanged).toHaveBeenCalledTimes(2);
    expect(onFeatureUsed).toHaveBeenCalledTimes(2);

    menu.dispose();
  });

  it("clamps both menu position minima and maxima to a 12-pixel viewport margin", () => {
    const { root, table, cell } = mountTable();
    const menu = new TableContextMenu({ editor: createEditor(table), hostRoot: root, onContentChanged: () => undefined });
    const node = document.querySelector(".rdx-context-menu");

    if (!(node instanceof HTMLDivElement)) {
      throw new Error("Missing menu");
    }

    Object.defineProperties(node, { offsetWidth: { value: 100 }, offsetHeight: { value: 80 } });
    Object.defineProperties(window, { innerWidth: { value: 200, configurable: true }, innerHeight: { value: 160, configurable: true } });

    menu.open(contextEvent(cell, 2, 3));
    expect(node.style.left).toBe("12px");
    expect(node.style.top).toBe("12px");

    menu.open(contextEvent(cell, 999, 999));
    expect(node.style.left).toBe("88px");
    expect(node.style.top).toBe("68px");

    menu.dispose();
  });

  it("emits bounded command diagnostics without callbacks when a Rooster operation fails", () => {
    const { root, table, cell } = mountTable();
    const onContentChanged = vi.fn();
    const onFeatureUsed = vi.fn();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    roosterApi.editTable.mockImplementation(() => {
      const failure = new Error("sensitive table contents");
      failure.name = "sensitive-error-name";
      throw failure;
    });
    const menu = new TableContextMenu({ editor: createEditor(table), hostRoot: root, onContentChanged, onFeatureUsed });

    menu.open(contextEvent(cell));
    button("insertAbove").click();

    expect(onContentChanged).not.toHaveBeenCalled();
    expect(onFeatureUsed).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith("[rdx-table]", "operation", "insertAbove", "Error");
    expect(warning.mock.calls.flat()).not.toContain("sensitive table contents");
    expect(warning.mock.calls.flat().some(value => value instanceof Error)).toBe(false);

    menu.dispose();
  });

  it.each([
    { label: "operation", commandId: "insertAbove", callback: "feature" as const },
    { label: "operation", commandId: "insertAbove", callback: "content" as const },
    { label: "shade", commandId: "shadeBlue", callback: "feature" as const },
    { label: "shade", commandId: "shadeBlue", callback: "content" as const }
  ])("notifies the other callback once when the $callback callback throws after a $label succeeds", ({ commandId, callback }) => {
    const { root, table, cell } = mountTable();
    const onContentChanged = vi.fn();
    const onFeatureUsed = vi.fn();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const throwingCallback = callback === "feature" ? onFeatureUsed : onContentChanged;
    throwingCallback.mockImplementation(() => {
      throw new Error("sensitive callback failure");
    });
    const menu = new TableContextMenu({ editor: createEditor(table), hostRoot: root, onContentChanged, onFeatureUsed });

    menu.open(contextEvent(cell));
    button(commandId).click();

    expect(onFeatureUsed).toHaveBeenCalledTimes(1);
    expect(onContentChanged).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith(
      "[rdx-table]",
      "callback",
      callback === "feature" ? "feature-used" : "content-changed",
      "Error"
    );
    expect(warning.mock.calls.some(([, kind]) => kind === "operation" || kind === "shade")).toBe(false);
    expect(warning.mock.calls.flat()).not.toContain("sensitive callback failure");

    menu.dispose();
  });

  it.each(["insertAbove", "shadeBlue"])("contains throwing diagnostics so both callbacks still run after %s", commandId => {
    const { root, table, cell } = mountTable();
    const onContentChanged = vi.fn(() => {
      throw new Error("sensitive content callback");
    });
    const onFeatureUsed = vi.fn(() => {
      throw new Error("sensitive feature callback");
    });
    vi.spyOn(console, "warn").mockImplementation(() => {
      throw new Error("broken diagnostic sink");
    });
    const menu = new TableContextMenu({ editor: createEditor(table), hostRoot: root, onContentChanged, onFeatureUsed });

    menu.open(contextEvent(cell));
    button(commandId).click();

    expect(onFeatureUsed).toHaveBeenCalledTimes(1);
    expect(onContentChanged).toHaveBeenCalledTimes(1);

    menu.dispose();
  });

  it("uses menu roles and moves focus through enabled commands with keyboard controls", () => {
    const { root, table, cell } = mountTable();
    const menu = new TableContextMenu({ editor: createEditor(table), hostRoot: root, onContentChanged: () => undefined });

    menu.open(contextEvent(cell));
    expect(document.querySelector(".rdx-context-menu")?.getAttribute("role")).toBe("menu");
    expect(button("insertAbove").getAttribute("role")).toBe("menuitem");
    expect(document.activeElement).toBe(button("insertAbove"));

    expect(press("ArrowUp").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(button("shadeGray"));
    press("ArrowDown");
    expect(document.activeElement).toBe(button("insertAbove"));
    press("End");
    expect(document.activeElement).toBe(button("shadeGray"));
    press("Home");
    expect(document.activeElement).toBe(button("insertAbove"));
    press("ArrowDown");
    expect(document.activeElement).toBe(button("insertBelow"));
    press("Enter");
    expect(roosterApi.editTable).toHaveBeenCalledWith(expect.anything(), "insertBelow");

    menu.open(contextEvent(cell));
    press(" ");
    expect(roosterApi.editTable).toHaveBeenLastCalledWith(expect.anything(), "insertAbove");

    menu.dispose();
  });

  it.each(["Enter", " "])("leaves %s with external focus to the unrelated button", key => {
    const externalButton = document.createElement("button");
    const externalClick = vi.fn();
    externalButton.addEventListener("click", externalClick);
    document.body.appendChild(externalButton);
    const { root, table, cell } = mountTable();
    const menu = new TableContextMenu({ editor: createEditor(table), hostRoot: root, onContentChanged: () => undefined });

    menu.open(contextEvent(cell));
    externalButton.focus();
    const event = press(key);

    expect(event.defaultPrevented).toBe(false);
    expect(externalClick).not.toHaveBeenCalled();
    expect(roosterApi.editTable).not.toHaveBeenCalled();

    menu.dispose();
  });

  it("closes for every global close path and restores a connected origin once", () => {
    const origin = document.createElement("button");
    document.body.appendChild(origin);
    const originFocus = vi.spyOn(origin, "focus");
    const { root, table, cell } = mountTable();
    const menu = new TableContextMenu({ editor: createEditor(table), hostRoot: root, onContentChanged: () => undefined });

    origin.focus();
    menu.open(contextEvent(cell));
    press("Escape");
    expect(document.querySelector(".rdx-context-menu")?.classList.contains("rdx-hidden")).toBe(true);
    expect(originFocus).toHaveBeenCalledTimes(2);

    menu.open(contextEvent(cell));
    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(originFocus).toHaveBeenCalledTimes(3);

    menu.open(contextEvent(cell));
    window.dispatchEvent(new Event("resize"));
    expect(originFocus).toHaveBeenCalledTimes(4);

    menu.open(contextEvent(cell));
    window.dispatchEvent(new Event("blur"));
    expect(originFocus).toHaveBeenCalledTimes(5);

    menu.hide();
    menu.hide();
    expect(originFocus).toHaveBeenCalledTimes(5);

    menu.dispose();
  });

  it("removes each global listener exactly once when disposed repeatedly", () => {
    const addDocumentListener = vi.spyOn(document, "addEventListener");
    const removeDocumentListener = vi.spyOn(document, "removeEventListener");
    const addWindowListener = vi.spyOn(window, "addEventListener");
    const removeWindowListener = vi.spyOn(window, "removeEventListener");
    const { root, table } = mountTable();
    const menu = new TableContextMenu({ editor: createEditor(table), hostRoot: root, onContentChanged: () => undefined });
    const documentAdds = addDocumentListener.mock.calls.filter(([type]) => type === "pointerdown" || type === "keydown");
    const windowAdds = addWindowListener.mock.calls.filter(([type]) => type === "resize" || type === "blur");

    menu.dispose();
    menu.dispose();

    expect(documentAdds).toHaveLength(2);
    expect(windowAdds).toHaveLength(2);
    for (const [type, listener, options] of documentAdds) {
      expect(removeDocumentListener).toHaveBeenCalledWith(type, listener, options);
      expect(removeDocumentListener.mock.calls.filter(([removedType]) => removedType === type)).toHaveLength(1);
    }
    for (const [type, listener, options] of windowAdds) {
      if (options === undefined) {
        expect(removeWindowListener).toHaveBeenCalledWith(type, listener);
      } else {
        expect(removeWindowListener).toHaveBeenCalledWith(type, listener, options);
      }
      expect(removeWindowListener.mock.calls.filter(([removedType]) => removedType === type)).toHaveLength(1);
    }
  });
});
