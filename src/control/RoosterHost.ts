import {
  createEditor,
  insertLink,
  insertTable,
  MarkdownPlugin,
  TableEditPlugin,
  toggleBold,
  toggleBullet,
  toggleItalic,
  toggleNumbering,
  toggleUnderline,
  type ContentModelFormatBase,
  type EditorPlugin,
  type ElementProcessor,
  type FormatApplier,
  type FormatParser,
  type IEditor,
  type Snapshot
} from "roosterjs";
import { TableContextMenu } from "./TableContextMenu";
import { toggleCodeBlock } from "./toggleCodeBlock";

export interface RoosterHostOptions {
  readonly enableMarkdownAutoformat: boolean;
  readonly enableCodeBlock: boolean;
  readonly onFeatureUsed?: (feature: "table" | "markdown" | "codeblock") => void;
}

type ChangeListener = (nextHtml: string) => void;

const ROOT_ATTRIBUTE = "data-rdx-content-root";
const EDITOR_LABEL = "Description editor";
const INTERNAL_CARRIER_ATTRIBUTE_PREFIX = "data-rdx-editor-";
const METADATA_CARRIER = "__rdxEditorMetadata";
const FORCED_CONTAINER_ID = "__rdx_editor_metadata_container__";
const temporaryMetadataContainers = new WeakSet<HTMLElement>();
const elementMetadataCarriers = new WeakMap<HTMLElement, MetadataCarrier>();
const appliedMetadataCarriers = new WeakMap<object, Map<string, HTMLElement>>();
let nextMetadataCarrierId = 1;

interface MetadataCarrier {
  readonly token: string;
  readonly className: string | null;
  readonly id: string | null;
  readonly forcedContainer: boolean;
  readonly serialized: string;
}

type MetadataElementGuard = (element: HTMLElement) => boolean;

function createMetadataParser(
  isCanonicalElement: MetadataElementGuard
): FormatParser<ContentModelFormatBase> {
  return (format, element) => {
    if (!isCanonicalElement(element)) {
      return;
    }

    delete format[METADATA_CARRIER];
    const carrier = getElementMetadataCarrier(element);
    if (carrier) {
      format[METADATA_CARRIER] = carrier.serialized;
    }
  };
}

function createBlockMetadataParser(
  isCanonicalElement: MetadataElementGuard,
  metadataParser: FormatParser<ContentModelFormatBase>
): FormatParser<ContentModelFormatBase> {
  return (format, element, context) => {
    if (!isCanonicalElement(element)) {
      return;
    }
    if (
      element.matches(
        "blockquote,div,section,table,thead,tbody,tfoot,tr,td,th"
      )
    ) {
      delete format[METADATA_CARRIER];
      return;
    }
    metadataParser(format, element, context, {});
  };
}

function createMetadataApplier(
  isCanonicalMode: () => boolean
): FormatApplier<ContentModelFormatBase> {
  return (format, element, context) => {
    if (!isCanonicalMode()) {
      return;
    }

    const carrier = parseMetadataCarrier(format[METADATA_CARRIER]);
    if (!carrier) {
      return;
    }

    let applied = appliedMetadataCarriers.get(context);
    if (!applied) {
      applied = new Map<string, HTMLElement>();
      appliedMetadataCarriers.set(context, applied);
    }

    const appliedElement = applied.get(carrier.token);
    if (appliedElement) {
      if (appliedElement === element) {
        return;
      }
      if (
        (carrier.forcedContainer && element.id === FORCED_CONTAINER_ID) ||
        (carrier.id !== null && element.id === carrier.id)
      ) {
        element.removeAttribute("id");
      }
      return;
    }
    applied.set(carrier.token, element);

    if (carrier.className !== null) {
      element.setAttribute("class", carrier.className);
    }
    if (carrier.id !== null) {
      element.setAttribute("id", carrier.id);
    } else if (carrier.forcedContainer && element.id === FORCED_CONTAINER_ID) {
      element.removeAttribute("id");
    }
  };
}

function getElementMetadataCarrier(element: HTMLElement): MetadataCarrier | null {
  const forcedContainer = temporaryMetadataContainers.has(element);
  const className = element.hasAttribute("class") ? element.getAttribute("class") : null;
  const id = !forcedContainer && element.hasAttribute("id") ? element.getAttribute("id") : null;
  if (className === null && id === null && !forcedContainer) {
    return null;
  }

  const existing = elementMetadataCarriers.get(element);
  if (
    existing?.className === className &&
    existing.id === id &&
    existing.forcedContainer === forcedContainer
  ) {
    return existing;
  }

  const value = {
    token: `m${nextMetadataCarrierId++}`,
    className,
    id,
    forcedContainer
  };
  const carrier: MetadataCarrier = {
    ...value,
    serialized: JSON.stringify(value)
  };
  elementMetadataCarriers.set(element, carrier);
  return carrier;
}

function parseMetadataCarrier(value: ContentModelFormatBase[string]): MetadataCarrier | null {
  if (typeof value !== "string") {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as Partial<MetadataCarrier>;
    if (
      typeof parsed.token !== "string" ||
      (parsed.className !== null && typeof parsed.className !== "string") ||
      (parsed.id !== null && typeof parsed.id !== "string") ||
      typeof parsed.forcedContainer !== "boolean"
    ) {
      return null;
    }
    return {
      token: parsed.token,
      className: parsed.className ?? null,
      id: parsed.id ?? null,
      forcedContainer: parsed.forcedContainer,
      serialized: value
    };
  } catch {
    return null;
  }
}

function createMetadataContainerProcessor(
  tagName: "blockquote" | "div" | "section",
  isCanonicalElement: MetadataElementGuard
): ElementProcessor<HTMLElement> {
  return (group, element, context) => {
    const defaultProcessor = context.defaultElementProcessors[tagName] as
      | ElementProcessor<HTMLElement>
      | undefined;
    if (!defaultProcessor) {
      context.defaultElementProcessors["*"](group, element, context);
      return;
    }

    if (!isCanonicalElement(element)) {
      defaultProcessor(group, element, context);
      return;
    }

    const shouldForceContainer = !!element.getAttribute("class") && !element.id;
    if (shouldForceContainer) {
      temporaryMetadataContainers.add(element);
      element.id = FORCED_CONTAINER_ID;
    }

    try {
      defaultProcessor(group, element, context);
    } finally {
      if (shouldForceContainer) {
        element.removeAttribute("id");
        temporaryMetadataContainers.delete(element);
      }
    }
  };
}

class CanonicalMetadataPlugin implements EditorPlugin {
  constructor(private readonly getCanonicalRoot: () => HTMLDivElement | null) {}

  getName = (): string => "CanonicalMetadata";

  initialize = (editor: IEditor): void => {
    const environment = editor.getEnvironment();
    const domSettings = environment.domToModelSettings.calculated;
    const modelSettings = environment.modelToDomSettings.calculated;
    const domOptions = environment.domToModelSettings.customized;
    const modelOptions = environment.modelToDomSettings.customized;
    const parserMap = domSettings.formatParsers as unknown as Record<
      string,
      Array<FormatParser<ContentModelFormatBase>>
    >;
    const applierMap = modelSettings.formatAppliers as unknown as Record<
      string,
      Array<FormatApplier<ContentModelFormatBase>>
    >;
    const defaultIdParser = domSettings.defaultFormatParsers.id;
    const isCanonicalMode = (): boolean => this.getCanonicalRoot() !== null;
    const isCanonicalElement = (element: HTMLElement): boolean => {
      const canonicalRoot = this.getCanonicalRoot();
      return canonicalRoot !== null && canonicalRoot.contains(element);
    };
    const metadataParser = createMetadataParser(isCanonicalElement);
    const blockMetadataParser = createBlockMetadataParser(
      isCanonicalElement,
      metadataParser
    );
    const metadataApplier = createMetadataApplier(isCanonicalMode);
    const metadataSafeIdParser: FormatParser<ContentModelFormatBase> = (
      format,
      element,
      context,
      defaultStyle
    ) => {
      if (isCanonicalElement(element)) {
        delete format.id;
      } else {
        (defaultIdParser as FormatParser<ContentModelFormatBase> | null)?.(
          format,
          element,
          context,
          defaultStyle
        );
      }
    };
    const metadataFormatParsers = {
      block: [blockMetadataParser],
      segment: [metadataParser],
      table: [metadataParser],
      tableCell: [metadataParser],
      tableRow: [metadataParser],
      listItemElement: [metadataParser],
      listLevel: [metadataParser],
      image: [metadataParser],
      link: [metadataParser],
      divider: [metadataParser],
      container: [metadataParser],
      general: [metadataParser]
    };
    const metadataFormatAppliers = {
      block: [metadataApplier],
      elementBasedSegment: [metadataApplier],
      table: [metadataApplier],
      tableCell: [metadataApplier],
      tableRow: [metadataApplier],
      listItemElement: [metadataApplier],
      listLevel: [metadataApplier],
      image: [metadataApplier],
      link: [metadataApplier],
      divider: [metadataApplier],
      container: [metadataApplier],
      general: [metadataApplier]
    };
    const metadataProcessorOverrides = {
      blockquote: createMetadataContainerProcessor("blockquote", isCanonicalElement),
      div: createMetadataContainerProcessor("div", isCanonicalElement),
      section: createMetadataContainerProcessor("section", isCanonicalElement)
    };

    domOptions.processorOverride = {
      ...domOptions.processorOverride,
      ...metadataProcessorOverrides
    };
    domOptions.formatParserOverride = {
      ...domOptions.formatParserOverride,
      id: metadataSafeIdParser
    };
    domOptions.additionalFormatParsers = mergeFormatHandlers(
      domOptions.additionalFormatParsers,
      metadataFormatParsers
    );
    modelOptions.additionalFormatAppliers = mergeFormatHandlers(
      modelOptions.additionalFormatAppliers,
      metadataFormatAppliers
    );
    Object.assign(domSettings.elementProcessors, metadataProcessorOverrides);
    for (const parsers of Object.values(parserMap)) {
      for (let index = 0; index < parsers.length; index += 1) {
        if (parsers[index] === defaultIdParser) {
          parsers[index] = metadataSafeIdParser;
        }
      }
    }
    appendFormatHandlers(parserMap, metadataFormatParsers);
    appendFormatHandlers(applierMap, metadataFormatAppliers);
  };

  dispose = (): void => undefined;
}

function appendFormatHandlers<THandler>(
  target: Record<string, THandler[]>,
  additions: Record<string, THandler[]>
): void {
  for (const [category, handlers] of Object.entries(additions)) {
    target[category]?.push(...handlers);
  }
}

function mergeFormatHandlers<TMap extends object>(
  existing: TMap | undefined,
  additions: object
): TMap {
  const result = { ...existing } as Record<string, unknown[]>;
  for (const [category, handlers] of Object.entries(additions)) {
    result[category] = [...(result[category] ?? []), ...(handlers as unknown[])];
  }
  return result as unknown as TMap;
}

export interface EditorHost {
  onChange(listener: ChangeListener): () => void;
  setHtml(nextHtml: string): void;
  getHtml(): string;
  setReadOnly(readOnly: boolean): void;
  setStatus(text: string): void;
  dispose(): void;
}

type ActionName =
  | "bold"
  | "italic"
  | "underline"
  | "bullet"
  | "number"
  | "link"
  | "table"
  | "code"
  | "undo"
  | "redo";

export class RoosterHost implements EditorHost {
  private readonly shell!: HTMLDivElement;
  private readonly toolbar!: HTMLDivElement;
  private readonly editorDiv!: HTMLDivElement;
  private readonly status!: HTMLDivElement;
  private readonly changeListeners = new Set<ChangeListener>();

  private readonly editor!: IEditor;
  private readonly disposeDomEvents!: () => void;
  private readonly tableContextMenu!: TableContextMenu;
  private readonly enableCodeBlock: boolean;
  private readonly enableMarkdownAutoformat: boolean;
  private readonly onFeatureUsed?: (feature: "table" | "markdown" | "codeblock") => void;
  private readonly toolbarButtons = new Map<ActionName, HTMLButtonElement>();
  private readonly toolbarButtonDisposers: Array<() => void> = [];
  private readonly delayedChangeTimerIds = new Set<number>();
  private lastKnownHtml = "";
  private activeChangeHtml: string | null = null;
  private queuedChangeHtml: string | null = null;
  private deliveringChanges = false;
  private disposed = false;
  private readOnly = false;

  constructor(parent: HTMLElement, options: RoosterHostOptions) {
    this.enableCodeBlock = options.enableCodeBlock;
    this.enableMarkdownAutoformat = options.enableMarkdownAutoformat;
    this.onFeatureUsed = options.onFeatureUsed;
    let shell: HTMLDivElement | null = null;
    let editor: IEditor | null = null;
    let tableContextMenu: TableContextMenu | null = null;
    let disposeDomEvents: (() => void) | null = null;

    try {
      shell = document.createElement("div");
      this.shell = shell;
      this.shell.className = "rdx-shell";

      this.toolbar = document.createElement("div");
      this.toolbar.className = "rdx-toolbar";
      this.toolbar.setAttribute("role", "toolbar");
      this.toolbar.setAttribute("aria-label", "Formatting toolbar");

      this.editorDiv = document.createElement("div");
      this.editorDiv.className = "rdx-editor";
      this.editorDiv.contentEditable = "true";
      this.editorDiv.setAttribute("aria-label", EDITOR_LABEL);

      this.status = document.createElement("div");
      this.status.className = "rdx-status";
      this.status.setAttribute("role", "status");
      this.status.setAttribute("aria-live", "polite");
      this.status.setAttribute("aria-label", "Editor status");
      this.status.textContent = "Ready";

      this.shell.appendChild(this.toolbar);
      this.shell.appendChild(this.editorDiv);
      this.shell.appendChild(this.status);
      parent.replaceChildren(this.shell);

      this.createToolbar(options.enableCodeBlock);

      const plugins: EditorPlugin[] = [
        new CanonicalMetadataPlugin(() => getDirectCanonicalRoot(this.editorDiv)),
        new TableEditPlugin()
      ];
      if (options.enableMarkdownAutoformat) {
        plugins.push(
          new MarkdownPlugin({
            bold: true,
            italic: true,
            strikethrough: true,
            codeFormat: { fontFamily: "Consolas, monospace" }
          })
        );
      }

      editor = createEditor(this.editorDiv, plugins);
      this.editor = editor;
      tableContextMenu = new TableContextMenu({
        editor: this.editor,
        hostRoot: this.editorDiv,
        onContentChanged: () => this.emitChange(),
        onFeatureUsed: () => this.notifyFeatureUsed("table")
      });
      this.tableContextMenu = tableContextMenu;

      disposeDomEvents = this.editor.attachDomEvent({
        input: { beforeDispatch: () => this.emitChange() },
        keyup: { beforeDispatch: () => this.emitChange() },
        keydown: { beforeDispatch: event => this.handleKeydown(event as KeyboardEvent) },
        cut: { beforeDispatch: () => this.scheduleDelayedChange() },
        paste: { beforeDispatch: event => this.handlePaste(event as ClipboardEvent) },
        contextmenu: { beforeDispatch: event => this.handleContextMenu(event as MouseEvent) }
      });
      this.disposeDomEvents = disposeDomEvents;
      this.lastKnownHtml = this.editorDiv.innerHTML;
    } catch (error) {
      this.disposed = true;
      this.delayedChangeTimerIds.forEach(timerId => window.clearTimeout(timerId));
      this.delayedChangeTimerIds.clear();
      this.activeChangeHtml = null;
      this.queuedChangeHtml = null;
      this.deliveringChanges = false;
      this.changeListeners.clear();
      this.toolbarButtonDisposers.forEach(disposeButton =>
        this.disposeSafely(disposeButton)
      );
      this.toolbarButtonDisposers.length = 0;
      this.toolbarButtons.clear();
      if (disposeDomEvents) {
        this.disposeSafely(disposeDomEvents);
      }
      if (tableContextMenu) {
        this.disposeSafely(() => tableContextMenu?.dispose());
      }
      if (editor) {
        this.disposeSafely(() => editor?.dispose());
      }
      if (shell) {
        this.disposeSafely(() => shell?.remove());
      }
      throw error;
    }
  }

  onChange(listener: ChangeListener): () => void {
    if (this.disposed) {
      return () => undefined;
    }

    this.changeListeners.add(listener);
    return () => {
      this.changeListeners.delete(listener);
    };
  }

  setHtml(nextHtml: string): void {
    this.editor.setLogicalRoot(this.editorDiv);
    this.editorDiv.innerHTML = nextHtml;
    stripInternalCarrierAttributes(this.editorDiv);
    this.synchronizeLogicalRoot();
    this.lastKnownHtml = this.getHtml();
    this.queuedChangeHtml = null;
    this.editor.takeSnapshot();
  }

  getHtml(): string {
    stripInternalCarrierAttributes(this.editorDiv);
    const publicRoot = this.editorDiv.cloneNode(true) as HTMLDivElement;
    const canonicalRoot = getDirectCanonicalRoot(publicRoot);
    canonicalRoot?.removeAttribute("contenteditable");
    canonicalRoot?.removeAttribute("aria-label");
    return publicRoot.innerHTML;
  }

  setReadOnly(readOnly: boolean): void {
    this.readOnly = readOnly;
    this.applyReadOnlyState();
    this.toolbarButtons.forEach(button => {
      button.disabled = readOnly;
    });
  }

  setStatus(text: string): void {
    this.status.textContent = text;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    this.delayedChangeTimerIds.forEach(timerId => window.clearTimeout(timerId));
    this.delayedChangeTimerIds.clear();
    this.queuedChangeHtml = null;
    this.changeListeners.clear();
    this.toolbarButtonDisposers.forEach(disposeButton => this.disposeSafely(disposeButton));
    this.toolbarButtonDisposers.length = 0;
    this.toolbarButtons.clear();

    this.disposeSafely(this.disposeDomEvents);
    this.disposeSafely(() => this.tableContextMenu.dispose());
    this.disposeSafely(() => this.editor.dispose());
    this.disposeSafely(() => this.shell.remove());
  }

  private emitChange(): void {
    if (this.disposed) {
      return;
    }

    this.tableContextMenu.hide();
    const html = this.getHtml();
    if (html === this.lastKnownHtml) {
      return;
    }
    this.lastKnownHtml = html;

    if (this.deliveringChanges) {
      this.queuedChangeHtml = html === this.activeChangeHtml ? null : html;
      return;
    }

    this.deliveringChanges = true;
    let nextHtml: string | null = html;
    try {
      while (nextHtml !== null && !this.disposed) {
        this.activeChangeHtml = nextHtml;
        this.queuedChangeHtml = null;
        const listeners = [...this.changeListeners];
        for (const listener of listeners) {
          if (this.disposed) {
            break;
          }
          try {
            listener(nextHtml);
          } catch {
            // Change listeners are independent observers.
          }
        }
        nextHtml = this.disposed ? null : this.queuedChangeHtml;
      }
    } finally {
      this.deliveringChanges = false;
      this.activeChangeHtml = null;
      this.queuedChangeHtml = null;
    }
  }

  private createToolbar(enableCodeBlock: boolean): void {
    this.addButton("Bold", "bold", () => toggleBold(this.editor));
    this.addButton("Italic", "italic", () => toggleItalic(this.editor));
    this.addButton("Underline", "underline", () => toggleUnderline(this.editor));
    this.addButton("Bullet", "bullet", () => toggleBullet(this.editor));
    this.addButton("Number", "number", () => toggleNumbering(this.editor));
    this.addButton("Link", "link", () => this.handleInsertLink());
    this.addButton("Table", "table", () => {
      insertTable(this.editor, 3, 3);
      this.notifyFeatureUsed("table");
    });
    if (enableCodeBlock) {
      this.addButton("Code", "code", () => this.handleCodeBlockAction());
    }
    this.addButton("Undo", "undo", () => this.moveSnapshot(-1));
    this.addButton("Redo", "redo", () => this.moveSnapshot(1));
  }

  private addButton(
    label: string,
    action: ActionName,
    onClick: () => boolean | void
  ): void {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.dataset.action = action;
    const handleClick = (): void => {
      if (this.disposed) {
        return;
      }
      if (onClick() !== false) {
        this.emitChange();
      }
    };
    button.addEventListener("click", handleClick);
    this.toolbarButtonDisposers.push(() => button.removeEventListener("click", handleClick));
    this.toolbar.appendChild(button);
    this.toolbarButtons.set(action, button);
  }

  private handleInsertLink(): boolean {
    const url = window.prompt("Link URL");
    const trimmedUrl = url?.trim() ?? "";

    if (!trimmedUrl) {
      return false;
    }

    insertLink(this.editor, trimmedUrl);
    return true;
  }

  private handlePaste(event: ClipboardEvent): void {
    if (this.disposed) {
      return;
    }
    this.trackMarkdownFeatureUsage(event);
    this.scheduleDelayedChange();
  }

  private scheduleDelayedChange(): void {
    if (this.disposed) {
      return;
    }
    const timerId = window.setTimeout(() => {
      this.delayedChangeTimerIds.delete(timerId);
      if (this.disposed) {
        return;
      }
      this.emitChange();
    }, 0);
    this.delayedChangeTimerIds.add(timerId);
  }

  private handleContextMenu(event: MouseEvent): void {
    if (this.disposed) {
      return;
    }
    this.tableContextMenu.open(event);
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (this.disposed || !this.enableCodeBlock || event.repeat || event.altKey) {
      return;
    }

    const isDigit8 =
      event.code === "Digit8" ||
      (!event.code && (event.key === "8" || event.key === "*"));
    const isCodeShortcut = event.shiftKey && (event.ctrlKey || event.metaKey) && isDigit8;

    if (isCodeShortcut) {
      event.preventDefault();
      this.handleCodeBlockAction();
      this.emitChange();
    }
  }

  private handleCodeBlockAction(): void {
    if (this.disposed) {
      return;
    }
    toggleCodeBlock(this.editor);
    this.notifyFeatureUsed("codeblock");
  }

  private trackMarkdownFeatureUsage(event: ClipboardEvent): void {
    if (this.disposed || !this.enableMarkdownAutoformat) {
      return;
    }

    const pastedText = event.clipboardData?.getData("text/plain") ?? "";
    if (!pastedText) {
      return;
    }

    const markdownPattern =
      /(^|\n)\s{0,3}(#{1,6}\s+|[-*+]\s+|\d+\.\s+|>\s+|```)|\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*/m;

    if (markdownPattern.test(pastedText)) {
      this.notifyFeatureUsed("markdown");
    }
  }

  private notifyFeatureUsed(feature: "table" | "markdown" | "codeblock"): void {
    if (this.disposed) {
      return;
    }
    try {
      this.onFeatureUsed?.(feature);
    } catch {
      // Optional feature observers must not interrupt editor actions.
    }
  }

  private moveSnapshot(step: -1 | 1): boolean {
    const manager = this.editor.getSnapshotsManager();
    const snapshot = manager.move(step);

    if (snapshot) {
      this.editor.restoreSnapshot(snapshot as Snapshot);
      stripInternalCarrierAttributes(this.editorDiv);
      this.applyReadOnlyState();
      this.ensureCanonicalSelection();
      return true;
    }

    return false;
  }

  private disposeSafely(disposeResource: () => void): void {
    try {
      disposeResource();
    } catch {
      // Owned resources are independent and all receive one cleanup attempt.
    }
  }

  private synchronizeLogicalRoot(): void {
    const canonicalRoot = getDirectCanonicalRoot(this.editorDiv);
    this.editor.setLogicalRoot(canonicalRoot ?? this.editorDiv);
    this.applyReadOnlyState();
  }

  private applyReadOnlyState(): void {
    const canonicalRoot = getDirectCanonicalRoot(this.editorDiv);
    if (canonicalRoot) {
      this.editorDiv.removeAttribute("aria-label");
      canonicalRoot.setAttribute("aria-label", EDITOR_LABEL);
      this.editorDiv.contentEditable = "false";
      canonicalRoot.contentEditable = this.readOnly ? "false" : "true";
    } else {
      this.editorDiv.setAttribute("aria-label", EDITOR_LABEL);
      this.editorDiv.contentEditable = this.readOnly ? "false" : "true";
    }
  }

  private ensureCanonicalSelection(): void {
    const canonicalRoot = getDirectCanonicalRoot(this.editorDiv);
    const selection = this.editor.getDOMSelection();
    const isContained =
      canonicalRoot &&
      selection &&
      (selection.type === "range"
        ? canonicalRoot.contains(selection.range.commonAncestorContainer)
        : selection.type === "table"
          ? canonicalRoot.contains(selection.table)
          : canonicalRoot.contains(selection.image));

    if (canonicalRoot && !isContained) {
      const range = this.editorDiv.ownerDocument.createRange();
      range.selectNodeContents(canonicalRoot);
      range.collapse(true);
      this.editor.setDOMSelection({ type: "range", range, isReverted: false });
    }
  }
}

function getDirectCanonicalRoot(editorDiv: HTMLDivElement): HTMLDivElement | null {
  const roots = [...editorDiv.children].filter(element =>
    element.hasAttribute(ROOT_ATTRIBUTE)
  );
  return roots.length === 1 && roots[0] instanceof HTMLDivElement ? roots[0] : null;
}

function stripInternalCarrierAttributes(root: ParentNode): void {
  for (const element of root.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) {
      if (attribute.name.startsWith(INTERNAL_CARRIER_ATTRIBUTE_PREFIX)) {
        element.removeAttribute(attribute.name);
      }
    }
  }
}
