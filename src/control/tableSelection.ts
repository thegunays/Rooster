import type { DOMSelection } from "roosterjs-content-model-types";

export type TableCellHorizontalAlignment = "left" | "center" | "right" | null;
export type TableCellVerticalAlignment = "top" | "middle" | "bottom" | null;
export type TableAlignment = "left" | "center" | "right" | null;

export interface TableSelectionSnapshot {
  readonly table: HTMLTableElement;
  readonly cell: HTMLTableCellElement;
  readonly rowCount: number;
  readonly columnCount: number;
  readonly selectedRowCount: number;
  readonly selectedColumnCount: number;
  readonly selectedCells: readonly HTMLTableCellElement[];
  readonly hasTableSelection: boolean;
  readonly hasMultiCellSelection: boolean;
  readonly cellHorizontalAlignment: TableCellHorizontalAlignment;
  readonly cellVerticalAlignment: TableCellVerticalAlignment;
  readonly tableAlignment: TableAlignment;
  readonly cellShadeColor: string | null;
  readonly cellShadeIsMixed: boolean;
}

export function getTableSelectionSnapshot(
  root: HTMLElement,
  selection: DOMSelection | null,
  eventTarget?: EventTarget | null
): TableSelectionSnapshot | null {
  const targetCell = getClosestTableCell(root, eventTarget);
  const targetTable = getClosestTable(root, eventTarget);
  const selectionCell =
    selection?.type === "range" ? getClosestTableCell(root, selection.range.startContainer) : null;
  const selectionTable =
    selection?.type === "range" ? getClosestTable(root, selection.range.startContainer) : null;

  let table: HTMLTableElement | null = null;
  let cell: HTMLTableCellElement | null = null;
  let selectedRowCount = 1;
  let selectedColumnCount = 1;
  let selectedCells: HTMLTableCellElement[] = [];
  let hasTableSelection = false;
  let selectionBounds: LogicalRectangle | null = null;
  let grid: LogicalTableGrid | null = null;

  if (selection?.type === "table" && root.contains(selection.table)) {
    table = selection.table;
    grid = buildLogicalTableGrid(table);
    selectionBounds = getValidSelectionBounds(selection, grid.rows);
    cell =
      targetTable === table && targetCell
        ? targetCell
        : (selectionBounds && getCellAtLogicalCoordinate(grid.rows, selectionBounds.firstRow, selectionBounds.firstColumn)) ??
          getFirstTableCell(grid.rows);
    selectedRowCount = selectionBounds ? selectionBounds.lastRow - selectionBounds.firstRow + 1 : 0;
    selectedColumnCount = selectionBounds ? selectionBounds.lastColumn - selectionBounds.firstColumn + 1 : 0;
    hasTableSelection = true;
  } else {
    table = targetTable ?? selectionTable;
    cell = targetCell ?? selectionCell;
  }

  if (!table || !cell || cell.closest("table") !== table) {
    return null;
  }

  grid ??= buildLogicalTableGrid(table);
  const metrics = getTableMetrics(table, grid.rows);
  let isFullyPopulatedSelection = false;

  if (hasTableSelection && selectionBounds) {
    const selection = getSelectedCells(grid.rows, selectionBounds);
    selectedCells = selection.cells;
    isFullyPopulatedSelection = selection.isFullyPopulated;
  } else {
    selectedCells = hasTableSelection ? [] : [cell];
  }

  const stateCells = selectedCells.length > 0 ? selectedCells : [cell];
  const cellShade = getAggregateCellShade(stateCells);

  return {
    table,
    cell,
    rowCount: metrics.rowCount,
    columnCount: metrics.columnCount,
    selectedRowCount,
    selectedColumnCount,
    selectedCells,
    hasTableSelection,
    hasMultiCellSelection:
      hasTableSelection &&
      !!selectionBounds &&
      isDistinctPhysicalCellRectangle(grid, selectionBounds, selectedCells, isFullyPopulatedSelection),
    cellHorizontalAlignment: getUniformCellValue(stateCells, getCellHorizontalAlignment),
    cellVerticalAlignment: getUniformCellValue(stateCells, getCellVerticalAlignment),
    tableAlignment: getTableAlignment(table),
    cellShadeColor: cellShade.color,
    cellShadeIsMixed: cellShade.isMixed
  };
}

export function getClosestTableCell(
  root: HTMLElement,
  source?: EventTarget | Node | null
): HTMLTableCellElement | null {
  const element = getClosestElement(root, source, "td,th");
  return element instanceof HTMLTableCellElement ? element : null;
}

export function getClosestTable(
  root: HTMLElement,
  source?: EventTarget | Node | null
): HTMLTableElement | null {
  const element = getClosestElement(root, source, "table");
  return element instanceof HTMLTableElement ? element : null;
}

function getClosestElement(
  root: HTMLElement,
  source: EventTarget | Node | null | undefined,
  selector: string
): Element | null {
  if (!source) {
    return null;
  }

  const node = source instanceof Node ? source : null;
  const element = node instanceof Element ? node : node?.parentElement ?? null;
  const closest = element?.closest(selector) ?? null;

  return closest && root.contains(closest) ? closest : null;
}

function getFirstTableCell(grid: HTMLTableCellElement[][]): HTMLTableCellElement | null {
  return grid.flat().find(Boolean) ?? null;
}

function getTableMetrics(
  table: HTMLTableElement,
  grid: HTMLTableCellElement[][]
): { rowCount: number; columnCount: number } {
  return {
    rowCount: table.rows.length,
    columnCount: grid.reduce((max, row) => Math.max(max, row.length), 0)
  };
}

function getCellAtLogicalCoordinate(
  grid: HTMLTableCellElement[][],
  rowIndex: number,
  columnIndex: number
): HTMLTableCellElement | null {
  return grid[rowIndex]?.[columnIndex] ?? null;
}

interface LogicalRectangle {
  firstRow: number;
  lastRow: number;
  firstColumn: number;
  lastColumn: number;
}

interface LogicalTableGrid {
  rows: HTMLTableCellElement[][];
  cellBounds: Map<HTMLTableCellElement, LogicalRectangle>;
}

interface SelectedCells {
  cells: HTMLTableCellElement[];
  isFullyPopulated: boolean;
}

function getValidSelectionBounds(
  selection: Extract<DOMSelection, { type: "table" }>,
  grid: HTMLTableCellElement[][]
): LogicalRectangle | null {
  const bounds = normalizeSelectionBounds(selection);
  if (!bounds) {
    return null;
  }

  const columnCount = grid.reduce((max, row) => Math.max(max, row.length), 0);
  return bounds.lastRow < grid.length && bounds.lastColumn < columnCount ? bounds : null;
}

function normalizeSelectionBounds(
  selection: Extract<DOMSelection, { type: "table" }>
): LogicalRectangle | null {
  const coordinates = [selection.firstRow, selection.lastRow, selection.firstColumn, selection.lastColumn];
  if (!coordinates.every(coordinate => Number.isSafeInteger(coordinate) && coordinate >= 0)) {
    return null;
  }

  return {
    firstRow: Math.min(selection.firstRow, selection.lastRow),
    lastRow: Math.max(selection.firstRow, selection.lastRow),
    firstColumn: Math.min(selection.firstColumn, selection.lastColumn),
    lastColumn: Math.max(selection.firstColumn, selection.lastColumn)
  };
}

function getSelectedCells(
  grid: HTMLTableCellElement[][],
  bounds: LogicalRectangle
): SelectedCells {
  const selectedCells = new Set<HTMLTableCellElement>();
  let isFullyPopulated = true;

  for (let row = bounds.firstRow; row <= bounds.lastRow; row += 1) {
    for (let column = bounds.firstColumn; column <= bounds.lastColumn; column += 1) {
      const cell = grid[row]?.[column];
      if (cell) {
        selectedCells.add(cell);
      } else {
        isFullyPopulated = false;
      }
    }
  }

  return { cells: [...selectedCells], isFullyPopulated };
}

function isDistinctPhysicalCellRectangle(
  grid: LogicalTableGrid,
  bounds: LogicalRectangle,
  selectedCells: readonly HTMLTableCellElement[],
  isFullyPopulated: boolean
): boolean {
  if (!isFullyPopulated || selectedCells.length < 2) {
    return false;
  }

  return selectedCells.every(cell => {
    const occupiedBounds = grid.cellBounds.get(cell);
    return (
      !!occupiedBounds &&
      occupiedBounds.firstRow >= bounds.firstRow &&
      occupiedBounds.lastRow <= bounds.lastRow &&
      occupiedBounds.firstColumn >= bounds.firstColumn &&
      occupiedBounds.lastColumn <= bounds.lastColumn
    );
  });
}

function buildLogicalTableGrid(table: HTMLTableElement): LogicalTableGrid {
  const rows = Array.from(table.rows);
  const grid: HTMLTableCellElement[][] = [];
  const cellBounds = new Map<HTMLTableCellElement, LogicalRectangle>();
  const rowGroupEnds = getRowGroupEnds(rows);

  rows.forEach((row, domRowIndex) => {
    const logicalRow = (grid[domRowIndex] ??= []);
    let nextColumn = 0;

    Array.from(row.cells).forEach(cell => {
      while (logicalRow[nextColumn]) {
        nextColumn += 1;
      }

      const lastRow = getLastSpannedRow(cell, domRowIndex, rowGroupEnds[domRowIndex]);
      const colSpan = Math.max(cell.colSpan, 1);

      for (let rowIndex = domRowIndex; rowIndex <= lastRow; rowIndex += 1) {
        const targetRow = (grid[rowIndex] ??= []);
        for (let columnOffset = 0; columnOffset < colSpan; columnOffset += 1) {
          targetRow[nextColumn + columnOffset] = cell;
        }
      }

      cellBounds.set(cell, {
        firstRow: domRowIndex,
        lastRow,
        firstColumn: nextColumn,
        lastColumn: nextColumn + colSpan - 1
      });
      nextColumn += colSpan;
    });
  });

  return { rows: grid, cellBounds };
}

function getRowGroupEnds(rows: HTMLTableRowElement[]): number[] {
  const ends: number[] = [];

  for (let start = 0; start < rows.length; ) {
    let end = start;
    while (end + 1 < rows.length && rows[end + 1].parentElement === rows[start].parentElement) {
      end += 1;
    }
    for (let rowIndex = start; rowIndex <= end; rowIndex += 1) {
      ends[rowIndex] = end;
    }
    start = end + 1;
  }

  return ends;
}

function getLastSpannedRow(
  cell: HTMLTableCellElement,
  rowIndex: number,
  rowGroupEnd: number
): number {
  const availableRows = rowGroupEnd - rowIndex + 1;
  const rowSpan = cell.rowSpan === 0 ? availableRows : Math.min(cell.rowSpan, availableRows);
  return rowIndex + Math.max(rowSpan, 1) - 1;
}

function getCellHorizontalAlignment(cell: HTMLTableCellElement): TableCellHorizontalAlignment {
  const value = window.getComputedStyle(cell).textAlign.toLowerCase();

  if (value === "start") {
    return "left";
  }

  if (value === "end") {
    return "right";
  }

  return value === "left" || value === "center" || value === "right" ? value : null;
}

function getCellVerticalAlignment(cell: HTMLTableCellElement): TableCellVerticalAlignment {
  const value = window.getComputedStyle(cell).verticalAlign.toLowerCase();

  return value === "top" || value === "middle" || value === "bottom" ? value : null;
}

function getTableAlignment(table: HTMLTableElement): TableAlignment {
  const marginLeft = table.style.marginLeft.trim().toLowerCase();
  const marginRight = table.style.marginRight.trim().toLowerCase();

  if (marginLeft === "auto" && marginRight === "auto") {
    return "center";
  }

  if (marginLeft === "auto") {
    return "right";
  }

  if (marginRight === "auto") {
    return "left";
  }

  return null;
}

function getCellShadeColor(cell: HTMLTableCellElement): string | null {
  const value = window.getComputedStyle(cell).backgroundColor.trim().toLowerCase();

  return value && value !== "transparent" && value !== "rgba(0, 0, 0, 0)" ? value : null;
}

function getUniformCellValue<T>(
  cells: readonly HTMLTableCellElement[],
  getValue: (cell: HTMLTableCellElement) => T
): T | null {
  const firstValue = getValue(cells[0]);
  return cells.every(cell => Object.is(getValue(cell), firstValue)) ? firstValue : null;
}

function getAggregateCellShade(
  cells: readonly HTMLTableCellElement[]
): { color: string | null; isMixed: boolean } {
  const firstColor = getCellShadeColor(cells[0]);
  const isMixed = cells.some(cell => getCellShadeColor(cell) !== firstColor);

  return {
    color: isMixed ? null : firstColor,
    isMixed
  };
}
