import { afterEach, describe, expect, it } from "vitest";
import type { DOMSelection } from "roosterjs-content-model-types";

import { getTableSelectionSnapshot } from "../../src/control/tableSelection";

function mountRoot(html: string): HTMLDivElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("tableSelection", () => {
  it("detects single-cell table context from a range selection", () => {
    const root = mountRoot('<table><tr><td><span>Alpha</span></td><td>Beta</td></tr></table>');
    const textNode = root.querySelector("span")?.firstChild;
    const range = document.createRange();

    if (!textNode) {
      throw new Error("Missing text node");
    }

    range.setStart(textNode, 0);
    range.collapse(true);

    const selection: DOMSelection = {
      type: "range",
      range,
      isReverted: false
    };

    const snapshot = getTableSelectionSnapshot(root, selection);

    expect(snapshot).not.toBeNull();
    expect(snapshot?.rowCount).toBe(1);
    expect(snapshot?.columnCount).toBe(2);
    expect(snapshot?.hasTableSelection).toBe(false);
    expect(snapshot?.hasMultiCellSelection).toBe(false);
    expect(snapshot?.cell.textContent).toContain("Alpha");
  });

  it("detects rectangular multi-cell selections from a table selection", () => {
    const root = mountRoot(
      "<table><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>"
    );
    const table = root.querySelector("table");

    if (!(table instanceof HTMLTableElement)) {
      throw new Error("Missing table");
    }

    const selection: DOMSelection = {
      type: "table",
      table,
      firstRow: 0,
      firstColumn: 0,
      lastRow: 1,
      lastColumn: 1
    };

    const snapshot = getTableSelectionSnapshot(root, selection);

    expect(snapshot).not.toBeNull();
    expect(snapshot?.hasTableSelection).toBe(true);
    expect(snapshot?.selectedRowCount).toBe(2);
    expect(snapshot?.selectedColumnCount).toBe(2);
    expect(snapshot?.hasMultiCellSelection).toBe(true);
    expect(snapshot?.selectedCells.map(cell => cell.textContent)).toEqual(["A", "B", "C", "D"]);
  });

  it("aggregates uniform alignment and shading across distinct selected cells", () => {
    const root = mountRoot(
      '<table style="margin-left:auto;margin-right:auto"><tr>' +
        '<td style="text-align:center;vertical-align:middle;background:#d9ead3">A</td>' +
        '<td style="text-align:center;vertical-align:middle;background:#d9ead3">B</td>' +
        "</tr></table>"
    );
    const table = root.querySelector("table");
    const cells = root.querySelectorAll<HTMLTableCellElement>("td");

    if (!(table instanceof HTMLTableElement)) {
      throw new Error("Missing table");
    }

    const snapshot = getTableSelectionSnapshot(
      root,
      {
        type: "table",
        table,
        firstRow: 0,
        firstColumn: 0,
        lastRow: 0,
        lastColumn: 1
      },
      cells[1]
    );

    expect(snapshot?.cellHorizontalAlignment).toBe("center");
    expect(snapshot?.cellVerticalAlignment).toBe("middle");
    expect(snapshot?.cellShadeColor).toBe("rgb(217, 234, 211)");
    expect(snapshot?.cellShadeIsMixed).toBe(false);
    expect(snapshot?.tableAlignment).toBe("center");

    cells.forEach(cell => {
      cell.style.background = "";
    });
    const uniformNoneSnapshot = getTableSelectionSnapshot(
      root,
      {
        type: "table",
        table,
        firstRow: 0,
        firstColumn: 0,
        lastRow: 0,
        lastColumn: 1
      },
      cells[0]
    );

    expect(uniformNoneSnapshot?.cellShadeColor).toBeNull();
    expect(uniformNoneSnapshot?.cellShadeIsMixed).toBe(false);
  });

  it("reports mixed alignment and an explicit mixed shading sentinel across selected cells", () => {
    const root = mountRoot(
      '<table style="margin-left:auto;margin-right:auto"><tr>' +
        '<td style="text-align:center;vertical-align:middle;background:#d9ead3">A</td>' +
        '<td style="text-align:right;vertical-align:bottom;background:#fff2cc">B</td>' +
        "</tr></table>"
    );
    const table = root.querySelector("table");
    const cells = root.querySelectorAll<HTMLTableCellElement>("td");

    if (!(table instanceof HTMLTableElement)) {
      throw new Error("Missing table");
    }

    const snapshot = getTableSelectionSnapshot(
      root,
      {
        type: "table",
        table,
        firstRow: 0,
        firstColumn: 0,
        lastRow: 0,
        lastColumn: 1
      },
      cells[0]
    );

    expect(snapshot?.cellHorizontalAlignment).toBeNull();
    expect(snapshot?.cellVerticalAlignment).toBeNull();
    expect(snapshot?.cellShadeColor).toBeNull();
    expect(snapshot?.cellShadeIsMixed).toBe(true);
    expect(snapshot?.tableAlignment).toBe("center");
  });

  it("does not treat one 2 by 2 merged physical cell as mergeable", () => {
    const root = mountRoot("<table><tr><td rowspan=\"2\" colspan=\"2\">A</td></tr><tr></tr></table>");
    const table = root.querySelector("table");

    if (!(table instanceof HTMLTableElement)) {
      throw new Error("Missing table");
    }

    const snapshot = getTableSelectionSnapshot(root, {
      type: "table",
      table,
      firstRow: 0,
      firstColumn: 0,
      lastRow: 1,
      lastColumn: 1
    });

    expect(snapshot?.hasMultiCellSelection).toBe(false);
  });

  it("keeps row deletion metrics tied to physical rows when a rowspan extends the logical grid", () => {
    const root = mountRoot("<table><tr><td rowspan=\"2\">A</td><td>B</td></tr></table>");
    const table = root.querySelector("table");

    if (!(table instanceof HTMLTableElement)) {
      throw new Error("Missing table");
    }

    const snapshot = getTableSelectionSnapshot(root, {
      type: "table",
      table,
      firstRow: 0,
      firstColumn: 0,
      lastRow: 0,
      lastColumn: 1
    });

    expect(snapshot?.rowCount).toBe(1);
    expect(snapshot?.columnCount).toBe(2);
  });

  it("normalizes reversed logical coordinates across a mixed-span table", () => {
    const root = mountRoot(
      "<table><tr><td rowspan=\"2\">A</td><td>B</td><td>C</td></tr><tr><td colspan=\"2\">D</td></tr></table>"
    );
    const table = root.querySelector("table");

    if (!(table instanceof HTMLTableElement)) {
      throw new Error("Missing table");
    }

    const snapshot = getTableSelectionSnapshot(root, {
      type: "table",
      table,
      firstRow: 1,
      firstColumn: 2,
      lastRow: 0,
      lastColumn: 1
    });

    expect(snapshot?.selectedRowCount).toBe(2);
    expect(snapshot?.selectedColumnCount).toBe(2);
    expect(snapshot?.hasMultiCellSelection).toBe(true);
  });

  it("rejects a logical rectangle that slices through a colspan cell", () => {
    const root = mountRoot(
      "<table><tr><td>A</td><td colspan=\"2\">B</td></tr><tr><td>C</td><td>D</td><td>E</td></tr></table>"
    );
    const table = root.querySelector("table");

    if (!(table instanceof HTMLTableElement)) {
      throw new Error("Missing table");
    }

    const snapshot = getTableSelectionSnapshot(root, {
      type: "table",
      table,
      firstRow: 0,
      firstColumn: 1,
      lastRow: 1,
      lastColumn: 1
    });

    expect(snapshot?.hasMultiCellSelection).toBe(false);
  });

  it("treats rowspan zero as spanning only the remaining rows of its row group", () => {
    const root = mountRoot(
      "<table><tbody><tr><td rowspan=\"0\">A</td><td>B</td></tr><tr><td>C</td></tr></tbody></table>"
    );
    const table = root.querySelector("table");

    if (!(table instanceof HTMLTableElement)) {
      throw new Error("Missing table");
    }

    const snapshot = getTableSelectionSnapshot(root, {
      type: "table",
      table,
      firstRow: 0,
      firstColumn: 0,
      lastRow: 1,
      lastColumn: 0
    });

    expect(snapshot?.selectedCells.map(cell => cell.textContent)).toEqual(["A"]);
    expect(snapshot?.hasMultiCellSelection).toBe(false);
  });

  it.each(["0", "5"])("does not let rowspan=%s cross into a later row group", rowSpan => {
    const root = mountRoot(
      `<table><tbody><tr><td rowspan="${rowSpan}">A</td><td>B</td></tr><tr><td>C</td></tr></tbody><tbody><tr><td>D</td></tr></tbody></table>`
    );
    const table = root.querySelector("table");

    if (!(table instanceof HTMLTableElement)) {
      throw new Error("Missing table");
    }

    const snapshot = getTableSelectionSnapshot(root, {
      type: "table",
      table,
      firstRow: 2,
      firstColumn: 0,
      lastRow: 2,
      lastColumn: 0
    });

    expect(snapshot?.cell.textContent).toBe("D");
    expect(snapshot?.selectedCells.map(cell => cell.textContent)).toEqual(["D"]);
  });

  it.each([
    { firstRow: -1, lastRow: 0, firstColumn: 0, lastColumn: 0 },
    { firstRow: 0.5, lastRow: 0, firstColumn: 0, lastColumn: 0 },
    { firstRow: Number.POSITIVE_INFINITY, lastRow: 0, firstColumn: 0, lastColumn: 0 },
    { firstRow: 0, lastRow: 0, firstColumn: Number.NaN, lastColumn: 0 },
    { firstRow: 9, lastRow: 9, firstColumn: 0, lastColumn: 0 }
  ])("returns a deterministic non-mergeable snapshot for invalid coordinates %#", coordinates => {
    const root = mountRoot("<table><tr><td>A</td><td>B</td></tr></table>");
    const table = root.querySelector("table");

    if (!(table instanceof HTMLTableElement)) {
      throw new Error("Missing table");
    }

    const snapshot = getTableSelectionSnapshot(root, { type: "table", table, ...coordinates } as DOMSelection);

    expect(snapshot?.hasTableSelection).toBe(true);
    expect(snapshot?.selectedRowCount).toBe(0);
    expect(snapshot?.selectedColumnCount).toBe(0);
    expect(snapshot?.selectedCells).toEqual([]);
    expect(snapshot?.hasMultiCellSelection).toBe(false);
  });

  it("keeps an outer table selection isolated from a nested-table event target", () => {
    const root = mountRoot(
      '<table id="outer"><tr><td id="outer-cell"><table id="inner"><tr><td id="inner-cell">Inner</td></tr></table></td></tr></table>'
    );
    const outer = root.querySelector("#outer");
    const outerCell = root.querySelector("#outer-cell");
    const innerCell = root.querySelector("#inner-cell");

    if (
      !(outer instanceof HTMLTableElement) ||
      !(outerCell instanceof HTMLTableCellElement) ||
      !(innerCell instanceof HTMLTableCellElement)
    ) {
      throw new Error("Missing nested table fixture");
    }

    const snapshot = getTableSelectionSnapshot(
      root,
      { type: "table", table: outer, firstRow: 0, firstColumn: 0, lastRow: 0, lastColumn: 0 },
      innerCell
    );

    expect(snapshot?.table).toBe(outer);
    expect(snapshot?.cell).toBe(outerCell);
  });

  it("prefers the right-click target when it is inside another table", () => {
    const root = mountRoot(
      [
        '<table id="first"><tr><td><span>One</span></td></tr></table>',
        '<table id="second"><tr><td><span>Two</span></td></tr></table>'
      ].join("")
    );
    const firstTextNode = root.querySelector("#first span")?.firstChild;
    const secondCell = root.querySelector("#second td");
    const range = document.createRange();

    if (!firstTextNode || !(secondCell instanceof HTMLTableCellElement)) {
      throw new Error("Missing table fixtures");
    }

    range.setStart(firstTextNode, 0);
    range.collapse(true);

    const selection: DOMSelection = {
      type: "range",
      range,
      isReverted: false
    };

    const snapshot = getTableSelectionSnapshot(root, selection, secondCell);

    expect(snapshot).not.toBeNull();
    expect(snapshot?.cell).toBe(secondCell);
    expect(snapshot?.table.id).toBe("second");
  });

  it("returns null when selection and event target are outside tables", () => {
    const root = mountRoot("<p><span>Plain text</span></p>");
    const textNode = root.querySelector("span")?.firstChild;
    const range = document.createRange();

    if (!textNode) {
      throw new Error("Missing text node");
    }

    range.setStart(textNode, 0);
    range.collapse(true);

    const selection: DOMSelection = {
      type: "range",
      range,
      isReverted: false
    };

    expect(getTableSelectionSnapshot(root, selection)).toBeNull();
  });
});
