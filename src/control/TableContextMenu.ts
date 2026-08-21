import { editTable, setTableCellShade } from "roosterjs-content-model-api";
import type { DOMSelection, IEditor, TableOperation } from "roosterjs-content-model-types";

import { getClosestTableCell, getTableSelectionSnapshot, type TableSelectionSnapshot } from "./tableSelection";

interface TableContextMenuOptions {
  editor: IEditor;
  hostRoot: HTMLElement;
  onContentChanged: () => void;
  onFeatureUsed?: () => void;
}

interface TableOperationItem {
  kind: "operation";
  id: string;
  label: string;
  operation: TableOperation;
  isEnabled: (context: TableSelectionSnapshot) => boolean;
  isActive?: (context: TableSelectionSnapshot) => boolean;
  choiceGroup?: TableChoiceGroup;
}

interface TableShadeItem {
  kind: "shade";
  id: string;
  label: string;
  color: string | null;
  previewColor: string;
  isEnabled: (context: TableSelectionSnapshot) => boolean;
  isActive?: (context: TableSelectionSnapshot) => boolean;
  choiceGroup?: TableChoiceGroup;
}

interface TableUnsupportedItem {
  kind: "unsupported";
  id: string;
  label: string;
  choiceGroup?: TableChoiceGroup;
}

type TableMenuItem = TableOperationItem | TableShadeItem | TableUnsupportedItem;

interface TableMenuSection {
  label: string;
  items: TableMenuItem[];
}

const TABLE_CHOICE_GROUPS = {
  "cell-horizontal": "Cell horizontal alignment",
  "cell-vertical": "Cell vertical alignment",
  "table-alignment": "Table alignment",
  "cell-shading": "Cell shading"
} as const;

type TableChoiceGroup = keyof typeof TABLE_CHOICE_GROUPS;

const TABLE_MENU_SECTIONS: TableMenuSection[] = [
  {
    label: "Insert",
    items: [
      createOperation("insertAbove", "Row Above", "insertAbove"),
      createOperation("insertBelow", "Row Below", "insertBelow"),
      createOperation("insertLeft", "Column Left", "insertLeft"),
      createOperation("insertRight", "Column Right", "insertRight")
    ]
  },
  {
    label: "Delete",
    items: [
      createOperation("deleteRow", "Delete Row", "deleteRow", context => context.rowCount > 1),
      createOperation(
        "deleteColumn",
        "Delete Column",
        "deleteColumn",
        context => context.columnCount > 1
      ),
      createOperation("deleteTable", "Delete Table", "deleteTable")
    ]
  },
  {
    label: "Merge",
    items: [
      createOperation(
        "mergeCells",
        "Merge Cells",
        "mergeCells",
        context => context.hasMultiCellSelection
      )
    ]
  },
  {
    label: "Split",
    items: [
      createOperation("splitHorizontally", "Split Columns", "splitHorizontally"),
      createOperation("splitVertically", "Split Rows", "splitVertically")
    ]
  },
  {
    label: "Align Cell",
    items: [
      createOperation("alignCellLeft", "Left", "alignCellLeft", undefined, context => context.cellHorizontalAlignment === "left", "cell-horizontal"),
      createOperation("alignCellCenter", "Center", "alignCellCenter", undefined, context => context.cellHorizontalAlignment === "center", "cell-horizontal"),
      createOperation("alignCellRight", "Right", "alignCellRight", undefined, context => context.cellHorizontalAlignment === "right", "cell-horizontal"),
      createOperation("alignCellTop", "Top", "alignCellTop", undefined, context => context.cellVerticalAlignment === "top", "cell-vertical"),
      createOperation("alignCellMiddle", "Middle", "alignCellMiddle", undefined, context => context.cellVerticalAlignment === "middle", "cell-vertical"),
      createOperation("alignCellBottom", "Bottom", "alignCellBottom", undefined, context => context.cellVerticalAlignment === "bottom", "cell-vertical")
    ]
  },
  {
    label: "Align Table",
    items: [
      createOperation("alignLeft", "Left", "alignLeft", undefined, context => context.tableAlignment === "left", "table-alignment"),
      createOperation("alignCenter", "Center", "alignCenter", undefined, context => context.tableAlignment === "center", "table-alignment"),
      createOperation("alignRight", "Right", "alignRight", undefined, context => context.tableAlignment === "right", "table-alignment"),
      {
        kind: "unsupported",
        id: "alignFullWidth",
        label: "Full Width",
        choiceGroup: "table-alignment"
      }
    ]
  },
  {
    label: "Shading",
    items: [
      createShade("shadeNone", "None", null, "transparent", () => true, context => context.cellShadeColor === null, "cell-shading"),
      createShade("shadeYellow", "Yellow", "#fff2cc", "#fff2cc", () => true, context =>
        context.cellShadeColor === "rgb(255, 242, 204)",
        "cell-shading"
      ),
      createShade("shadeGreen", "Green", "#d9ead3", "#d9ead3", () => true, context =>
        context.cellShadeColor === "rgb(217, 234, 211)",
        "cell-shading"
      ),
      createShade("shadeBlue", "Blue", "#d0e0ff", "#d0e0ff", () => true, context =>
        context.cellShadeColor === "rgb(208, 224, 255)",
        "cell-shading"
      ),
      createShade("shadeGray", "Gray", "#e5e7eb", "#e5e7eb", () => true, context =>
        context.cellShadeColor === "rgb(229, 231, 235)",
        "cell-shading"
      )
    ]
  }
];

export class TableContextMenu {
  private readonly editor: IEditor;
  private readonly hostRoot: HTMLElement;
  private readonly onContentChanged: () => void;
  private readonly onFeatureUsed?: () => void;
  private readonly menu: HTMLDivElement;
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private currentContext: TableSelectionSnapshot | null = null;
  private originElement: HTMLElement | null = null;
  private cleanupComplete = false;
  private ownsPointerListener = true;
  private ownsKeydownListener = true;
  private ownsResizeListener = true;
  private ownsBlurListener = true;
  private ownsMenuContextListener = true;
  private ownsMenuNode = false;
  private ownsMenuContents = true;

  constructor(options: TableContextMenuOptions) {
    this.editor = options.editor;
    this.hostRoot = options.hostRoot;
    this.onContentChanged = options.onContentChanged;
    this.onFeatureUsed = options.onFeatureUsed;

    this.menu = document.createElement("div");
    try {
      this.menu.className = "rdx-context-menu rdx-hidden";
      this.menu.setAttribute("role", "menu");
      this.menu.addEventListener("contextmenu", this.handleMenuContextMenu);

      this.buildMenu();
      this.ownsMenuNode = true;
      document.body.appendChild(this.menu);

      document.addEventListener("pointerdown", this.handleDocumentPointerDown, true);
      document.addEventListener("keydown", this.handleDocumentKeydown, true);
      window.addEventListener("resize", this.hide);
      window.addEventListener("blur", this.hide);
    } catch (error) {
      for (let attempt = 0; attempt < 2 && !this.cleanupComplete; attempt += 1) {
        this.cleanupOwnedResources();
      }
      throw error;
    }
  }

  open(event: MouseEvent): boolean {
    const targetCell = getClosestTableCell(this.hostRoot, event.target);
    if (!targetCell) {
      this.hide();
      return false;
    }

    const selection = this.editor.getDOMSelection();
    let nextContext = getTableSelectionSnapshot(this.hostRoot, selection, event.target);

    if (shouldMoveSelectionToTargetCell(selection, targetCell, this.hostRoot, nextContext)) {
      this.setSelectionToCell(targetCell);
      nextContext = getTableSelectionSnapshot(
        this.hostRoot,
        this.editor.getDOMSelection(),
        event.target
      );
    }

    if (!nextContext) {
      this.hide();
      return false;
    }

    event.preventDefault();
    if (this.menu.classList.contains("rdx-hidden")) {
      this.originElement = getConnectedActiveElement();
    }
    this.currentContext = nextContext;
    this.updateButtonStates(nextContext);
    this.positionMenu(event.clientX, event.clientY);
    this.menu.classList.remove("rdx-hidden");
    this.focusFirstEnabledButton();

    return true;
  }

  hide = (): void => {
    const wasOpen = !this.menu.classList.contains("rdx-hidden");
    this.currentContext = null;
    this.menu.classList.add("rdx-hidden");
    if (!wasOpen) {
      return;
    }

    const origin = this.originElement;
    this.originElement = null;
    if (origin?.isConnected) {
      origin.focus();
    }
  };

  dispose(): void {
    if (this.cleanupComplete) {
      return;
    }

    for (let attempt = 0; attempt < 2 && !this.cleanupComplete; attempt += 1) {
      this.cleanupOwnedResources();
    }
  }

  private cleanupOwnedResources(): void {
    this.attemptCleanup(() => this.hide());
    this.currentContext = null;
    this.originElement = null;
    if (
      this.ownsPointerListener &&
      this.attemptCleanup(() =>
        document.removeEventListener("pointerdown", this.handleDocumentPointerDown, true)
      )
    ) {
      this.ownsPointerListener = false;
    }
    if (
      this.ownsKeydownListener &&
      this.attemptCleanup(() =>
        document.removeEventListener("keydown", this.handleDocumentKeydown, true)
      )
    ) {
      this.ownsKeydownListener = false;
    }
    if (
      this.ownsResizeListener &&
      this.attemptCleanup(() => window.removeEventListener("resize", this.hide))
    ) {
      this.ownsResizeListener = false;
    }
    if (
      this.ownsBlurListener &&
      this.attemptCleanup(() => window.removeEventListener("blur", this.hide))
    ) {
      this.ownsBlurListener = false;
    }
    if (
      this.ownsMenuContextListener &&
      this.attemptCleanup(() =>
        this.menu.removeEventListener("contextmenu", this.handleMenuContextMenu)
      )
    ) {
      this.ownsMenuContextListener = false;
    }
    if (this.ownsMenuNode) {
      const removed = this.attemptCleanup(() => this.menu.remove());
      if (!removed && this.menu.parentNode) {
        this.attemptCleanup(() => this.menu.parentNode?.removeChild(this.menu));
      }
      if (!this.menu.parentNode) {
        this.ownsMenuNode = false;
      }
    }
    if (this.ownsMenuContents && this.attemptCleanup(() => this.menu.replaceChildren())) {
      this.ownsMenuContents = false;
    }
    this.attemptCleanup(() => this.buttons.clear());
    this.cleanupComplete =
      !this.ownsPointerListener &&
      !this.ownsKeydownListener &&
      !this.ownsResizeListener &&
      !this.ownsBlurListener &&
      !this.ownsMenuContextListener &&
      !this.ownsMenuNode &&
      !this.ownsMenuContents;
  }

  private attemptCleanup(cleanup: () => void): boolean {
    try {
      cleanup();
      return true;
    } catch {
      // Cleanup is best-effort so one hostile DOM sink cannot leak later ownership.
      return false;
    }
  }

  private buildMenu(): void {
    TABLE_MENU_SECTIONS.forEach(section => {
      const sectionNode = document.createElement("div");
      sectionNode.className = "rdx-context-section";

      const label = document.createElement("div");
      label.className = "rdx-context-label";
      label.textContent = section.label;
      sectionNode.appendChild(label);

      const actions = document.createElement("div");
      actions.className = "rdx-context-actions";
      const choiceGroups = new Map<TableChoiceGroup, HTMLDivElement>();

      section.items.forEach(item => {
        const actionContainer = item.choiceGroup
          ? getChoiceGroupContainer(actions, choiceGroups, item.choiceGroup)
          : actions;
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("role", isSelectableItem(item) ? "menuitemradio" : "menuitem");
        button.className =
          item.kind === "shade" ? "rdx-context-button rdx-context-swatch" : "rdx-context-button";
        button.textContent = item.label;
        button.dataset.commandId = item.id;
        button.addEventListener("mousedown", event => {
          event.preventDefault();
        });

        if (item.kind === "operation") {
          button.addEventListener("click", () => {
            this.runOperation(item);
          });
        } else if (item.kind === "shade") {
          button.style.setProperty("--rdx-swatch-color", item.previewColor);
          button.addEventListener("click", () => {
            this.runShade(item);
          });
        } else {
          button.disabled = true;
        }

        actionContainer.appendChild(button);
        this.buttons.set(item.id, button);
      });

      sectionNode.appendChild(actions);
      this.menu.appendChild(sectionNode);
    });
  }

  private updateButtonStates(context: TableSelectionSnapshot): void {
    TABLE_MENU_SECTIONS.forEach(section => {
      section.items.forEach(item => {
        const button = this.buttons.get(item.id);
        if (!button) {
          return;
        }

        if (item.kind === "unsupported") {
          button.disabled = true;
          button.setAttribute("aria-disabled", "true");
          if (isSelectableItem(item)) {
            button.setAttribute("aria-checked", "false");
          } else {
            button.removeAttribute("aria-checked");
          }
          button.removeAttribute("aria-pressed");
          button.classList.remove("is-active");
          return;
        }

        button.disabled = !item.isEnabled(context);
        const isActive =
          !(item.kind === "shade" && context.cellShadeIsMixed) &&
          !!item.isActive?.(context);
        button.setAttribute("aria-disabled", String(button.disabled));
        if (isSelectableItem(item)) {
          button.setAttribute("aria-checked", String(isActive));
        } else {
          button.removeAttribute("aria-checked");
        }
        button.removeAttribute("aria-pressed");
        button.classList.toggle("is-active", isActive);
      });
    });
  }

  private positionMenu(clientX: number, clientY: number): void {
    this.menu.classList.remove("rdx-hidden");

    const margin = 12;
    const width = this.menu.offsetWidth;
    const height = this.menu.offsetHeight;
    const maxLeft = Math.max(margin, window.innerWidth - width - margin);
    const maxTop = Math.max(margin, window.innerHeight - height - margin);

    this.menu.style.left = `${Math.max(margin, Math.min(clientX, maxLeft))}px`;
    this.menu.style.top = `${Math.max(margin, Math.min(clientY, maxTop))}px`;
  }

  private runOperation(item: TableOperationItem): void {
    if (!this.currentContext || !item.isEnabled(this.currentContext)) {
      return;
    }

    try {
      try {
        editTable(this.editor, item.operation);
      } catch (error) {
        logTableFailure("operation", item.operation, error);
        return;
      }
      this.notifySuccessfulCommand();
    } finally {
      this.hide();
    }
  }

  private runShade(item: TableShadeItem): void {
    if (!this.currentContext || !item.isEnabled(this.currentContext)) {
      return;
    }

    try {
      try {
        setTableCellShade(this.editor, item.color);
      } catch (error) {
        logTableFailure("shade", item.id, error);
        return;
      }
      this.notifySuccessfulCommand();
    } finally {
      this.hide();
    }
  }

  private notifySuccessfulCommand(): void {
    this.notifyCallback("feature-used", this.onFeatureUsed);
    this.notifyCallback("content-changed", this.onContentChanged);
  }

  private notifyCallback(code: "feature-used" | "content-changed", callback: (() => void) | undefined): void {
    try {
      callback?.();
    } catch (error) {
      logTableFailure("callback", code, error);
    }
  }

  private setSelectionToCell(cell: HTMLTableCellElement): void {
    const range = cell.ownerDocument.createRange();
    const anchorNode = getFirstLeafNode(cell) ?? cell;

    range.setStart(anchorNode, 0);
    range.collapse(true);

    this.editor.setDOMSelection({
      type: "range",
      range,
      isReverted: false
    });
  }

  private handleDocumentPointerDown = (event: PointerEvent): void => {
    const target = event.target;

    if (target instanceof Node && this.menu.contains(target)) {
      return;
    }

    this.hide();
  };

  private handleMenuContextMenu = (event: Event): void => {
    event.preventDefault();
  };

  private handleDocumentKeydown = (event: KeyboardEvent): void => {
    if (this.menu.classList.contains("rdx-hidden")) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      this.hide();
      return;
    }

    const enabledButtons = this.getEnabledButtons();
    if (!enabledButtons.length) {
      return;
    }

    if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
      const activeButton = document.activeElement;
      if (!(activeButton instanceof HTMLButtonElement) || !enabledButtons.includes(activeButton)) {
        return;
      }
      event.preventDefault();
      activeButton.click();
      return;
    }

    const activeIndex = Math.max(enabledButtons.indexOf(document.activeElement as HTMLButtonElement), 0);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      enabledButtons[(activeIndex + 1) % enabledButtons.length].focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      enabledButtons[(activeIndex - 1 + enabledButtons.length) % enabledButtons.length].focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      enabledButtons[0].focus();
    } else if (event.key === "End") {
      event.preventDefault();
      enabledButtons[enabledButtons.length - 1].focus();
    }
  };

  private focusFirstEnabledButton(): void {
    this.getEnabledButtons()[0]?.focus();
  }

  private getEnabledButtons(): HTMLButtonElement[] {
    return [...this.buttons.values()].filter(button => !button.disabled);
  }
}

function createOperation(
  id: string,
  label: string,
  operation: TableOperation,
  isEnabled: (context: TableSelectionSnapshot) => boolean = () => true,
  isActive?: (context: TableSelectionSnapshot) => boolean,
  choiceGroup?: TableChoiceGroup
): TableOperationItem {
  return {
    kind: "operation",
    id,
    label,
    operation,
    isEnabled,
    isActive,
    choiceGroup
  };
}

function isSelectableItem(item: TableMenuItem): boolean {
  return !!item.choiceGroup;
}

function createShade(
  id: string,
  label: string,
  color: string | null,
  previewColor: string,
  isEnabled: (context: TableSelectionSnapshot) => boolean,
  isActive?: (context: TableSelectionSnapshot) => boolean,
  choiceGroup?: TableChoiceGroup
): TableShadeItem {
  return {
    kind: "shade",
    id,
    label,
    color,
    previewColor,
    isEnabled,
    isActive,
    choiceGroup
  };
}

function getChoiceGroupContainer(
  actions: HTMLDivElement,
  choiceGroups: Map<TableChoiceGroup, HTMLDivElement>,
  choiceGroup: TableChoiceGroup
): HTMLDivElement {
  const existing = choiceGroups.get(choiceGroup);
  if (existing) {
    return existing;
  }

  const group = document.createElement("div");
  group.className = "rdx-context-choice-group";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", TABLE_CHOICE_GROUPS[choiceGroup]);
  actions.appendChild(group);
  choiceGroups.set(choiceGroup, group);
  return group;
}

function shouldMoveSelectionToTargetCell(
  selection: DOMSelection | null,
  targetCell: HTMLTableCellElement,
  root: HTMLElement,
  selectionContext: TableSelectionSnapshot | null
): boolean {
  if (!selection) {
    return true;
  }

  if (selection.type === "table") {
    if (selection.table !== targetCell.closest("table")) {
      return true;
    }

    return !selectionContext?.selectedCells.includes(targetCell);
  }

  if (selection.type !== "range") {
    return true;
  }

  const selectionCell = getClosestTableCell(root, selection.range.startContainer);

  return selectionCell !== targetCell;
}

function getFirstLeafNode(node: Node): Node | null {
  let current: Node | null = node;

  while (current?.firstChild) {
    current = current.firstChild;
  }

  return current;
}

function logTableFailure(kind: "operation" | "shade" | "callback", code: string, error: unknown): void {
  const errorCode = error instanceof Error ? "Error" : "UnknownError";
  try {
    console.warn("[rdx-table]", kind, code, errorCode);
  } catch {
    // Diagnostics must never disrupt table commands or their independent callbacks.
  }
}

function getConnectedActiveElement(): HTMLElement | null {
  const activeElement = document.activeElement;
  return activeElement instanceof HTMLElement && activeElement.isConnected ? activeElement : null;
}
