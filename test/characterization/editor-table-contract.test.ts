import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("roosterjs", () => {
  class MarkdownPlugin {
    constructor(_options: unknown) {}
  }

  class TableEditPlugin {}

  return {
    MarkdownPlugin,
    TableEditPlugin,
    createEditor: () => ({
      attachDomEvent: () => () => undefined,
      dispose: () => undefined,
      getDOMSelection: () => null,
      getSnapshotsManager: () => ({ move: () => null }),
      restoreSnapshot: () => undefined,
      setDOMSelection: () => undefined,
      takeSnapshot: () => undefined
    }),
    insertLink: () => undefined,
    insertTable: () => undefined,
    toggleBold: () => undefined,
    toggleBullet: () => undefined,
    toggleItalic: () => undefined,
    toggleNumbering: () => undefined,
    toggleUnderline: () => undefined
  };
});

vi.mock("roosterjs-content-model-api", () => ({
  editTable: () => undefined,
  setTableCellShade: () => undefined
}));

import { RoosterHost } from "../../src/control/RoosterHost";
import { TableContextMenu } from "../../src/control/TableContextMenu";

afterEach(() => {
  document.body.replaceChildren();
});

function mountRoot(): HTMLDivElement {
  const root = document.createElement("div");
  document.body.appendChild(root);
  return root;
}

function command(id: string): HTMLButtonElement {
  const button = document.querySelector(`[data-command-id="${id}"]`);
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Missing ${id} command`);
  }
  return button;
}

function contextEvent(target: HTMLTableCellElement): MouseEvent {
  const event = new MouseEvent("contextmenu", { bubbles: true, clientX: 40, clientY: 40 });
  Object.defineProperty(event, "target", { value: target });
  return event;
}

describe("legacy editor and table-menu contract", () => {
  it("renders the exact toolbar order, with Code controlled by its configuration", () => {
    const root = mountRoot();
    const withCode = new RoosterHost(root, {
      enableMarkdownAutoformat: true,
      enableCodeBlock: true
    });

    expect(root.querySelector(".rdx-status")?.textContent).toBe("Ready");
    expect([...root.querySelectorAll<HTMLButtonElement>(".rdx-toolbar button")].map(button => button.textContent)).toEqual([
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
    withCode.dispose();

    const withoutCode = new RoosterHost(root, {
      enableMarkdownAutoformat: false,
      enableCodeBlock: false
    });
    expect([...root.querySelectorAll<HTMLButtonElement>(".rdx-toolbar button")].map(button => button.textContent)).toEqual([
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
    withoutCode.dispose();
  });

  it("renders every table section and source-authoritative command label", () => {
    const root = mountRoot();
    const menu = new TableContextMenu({ editor: {} as never, hostRoot: root, onContentChanged: () => undefined });

    expect([...document.querySelectorAll(".rdx-context-label")].map(label => label.textContent)).toEqual([
      "Insert",
      "Delete",
      "Merge",
      "Split",
      "Align Cell",
      "Align Table",
      "Shading"
    ]);
    expect([...document.querySelectorAll<HTMLButtonElement>(".rdx-context-button")].map(button => button.textContent)).toEqual([
      "Row Above",
      "Row Below",
      "Column Left",
      "Column Right",
      "Delete Row",
      "Delete Column",
      "Delete Table",
      "Merge Cells",
      "Split Columns",
      "Split Rows",
      "Left",
      "Center",
      "Right",
      "Top",
      "Middle",
      "Bottom",
      "Left",
      "Center",
      "Right",
      "Full Width",
      "None",
      "Yellow",
      "Green",
      "Blue",
      "Gray"
    ]);
    menu.dispose();
  });

  it("reflects legacy disabled and active table states", () => {
    const root = mountRoot();
    root.innerHTML =
      '<table style="margin-right:auto"><tr><td style="text-align:center;vertical-align:middle;background:#d9ead3">One</td></tr></table>';
    const table = root.querySelector("table");
    const cell = root.querySelector("td");
    if (!(table instanceof HTMLTableElement) || !(cell instanceof HTMLTableCellElement)) {
      throw new Error("Missing table fixture");
    }
    const menu = new TableContextMenu({
      editor: {
        getDOMSelection: () => ({
          type: "table",
          table,
          firstRow: 0,
          lastRow: 0,
          firstColumn: 0,
          lastColumn: 0
        }),
        setDOMSelection: () => undefined
      } as never,
      hostRoot: root,
      onContentChanged: () => undefined
    });

    expect(menu.open(contextEvent(cell))).toBe(true);
    expect(command("deleteRow").disabled).toBe(true);
    expect(command("deleteColumn").disabled).toBe(true);
    expect(command("mergeCells").disabled).toBe(true);
    expect(command("alignCellCenter").classList.contains("is-active")).toBe(true);
    expect(command("alignCellMiddle").classList.contains("is-active")).toBe(true);
    expect(command("alignLeft").classList.contains("is-active")).toBe(true);
    expect(command("shadeGreen").classList.contains("is-active")).toBe(true);
    expect(command("alignFullWidth").disabled).toBe(true);
    menu.dispose();
  });

  it("enables deletion and merge for a rectangular multi-cell selection", () => {
    const root = mountRoot();
    root.innerHTML = "<table><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>";
    const table = root.querySelector("table");
    const cell = root.querySelector("td");
    if (!(table instanceof HTMLTableElement) || !(cell instanceof HTMLTableCellElement)) {
      throw new Error("Missing table fixture");
    }
    const menu = new TableContextMenu({
      editor: {
        getDOMSelection: () => ({
          type: "table",
          table,
          firstRow: 0,
          lastRow: 1,
          firstColumn: 0,
          lastColumn: 1
        }),
        setDOMSelection: () => undefined
      } as never,
      hostRoot: root,
      onContentChanged: () => undefined
    });

    expect(menu.open(contextEvent(cell))).toBe(true);
    expect(command("deleteRow").disabled).toBe(false);
    expect(command("deleteColumn").disabled).toBe(false);
    expect(command("mergeCells").disabled).toBe(false);
    menu.dispose();
  });
});
