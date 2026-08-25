import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import type { DOMHelper, IEditor } from "roosterjs";

import { Sanitizer } from "../../src/bridge/Sanitizer";
import { RoosterHost } from "../../src/control/RoosterHost";

const sanitizer = new Sanitizer();
const bkuFixture = readFileSync(resolve("test/fixtures/bku-template.html"), "utf8");

const disposables: Array<() => void> = [];

if (!("getBoundingClientRect" in Range.prototype)) {
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(0, 0, 0, 0)
  });
}

afterEach(() => {
  while (disposables.length > 0) {
    disposables.pop()?.();
  }
  document.body.replaceChildren();
});

describe("RoosterHost canonical BKU ownership", () => {
  it("preserves the canonical envelope, metadata, and visual rules through keyboard Row Below", () => {
    const canonical = sanitizer.normalizeHtml(bkuFixture);
    const { host, editorDiv } = createHost(canonical);
    const stylesheetText = requiredDirectChild(editorDiv, "style").textContent;
    const beforeRoot = requiredDirectChild(editorDiv, "[data-rdx-content-root]");
    const beforeTable = requiredElement<HTMLTableElement>(beforeRoot, "#myTable1.pdf_table");
    const metadataBefore = metadataInventory(beforeRoot);

    expect(host.getHtml()).toBe(canonical);
    expect(beforeTable.rows).toHaveLength(11);
    assertVisualContract(editorDiv);

    const changes: string[] = [];
    host.onChange(nextHtml => changes.push(nextHtml));

    const contextEvent = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 40,
      clientY: 40
    });
    requiredElement<HTMLTableCellElement>(beforeTable, "td").dispatchEvent(contextEvent);
    expect(contextEvent.defaultPrevented).toBe(true);

    const firstItem = requiredElement<HTMLButtonElement>(document, '[data-command-id="insertAbove"]');
    expect(document.activeElement).toBe(firstItem);
    pressMenuKey("ArrowDown");
    expect(document.activeElement).toBe(
      requiredElement<HTMLButtonElement>(document, '[data-command-id="insertBelow"]')
    );
    pressMenuKey("Enter");

    expect(changes).toHaveLength(1);
    expect(changes[0]).toBe(host.getHtml());
    expect(
      selectionIsContained(
        getInstalledEditor(host),
        requiredDirectChild(editorDiv, "[data-rdx-content-root]")
      )
    ).toBe(true);
    expect(requiredDirectChild(editorDiv, "style").textContent).toBe(stylesheetText);
    expect(directChildren(editorDiv, "style")).toHaveLength(1);
    expect(directChildren(editorDiv, "[data-rdx-content-root]")).toHaveLength(1);
    expect(
      requiredElement<HTMLTableElement>(editorDiv, "#myTable1.pdf_table").rows
    ).toHaveLength(12);
    expect(
      [...editorDiv.querySelectorAll(".title.grey")].map(
        element => `${element.tagName}:${element.parentElement?.tagName}`
      )
    ).toEqual([
      "TH:TR",
      "TH:TR",
      "TH:TR",
      "TH:TR"
    ]);
    expect(metadataInventory(requiredDirectChild(editorDiv, "[data-rdx-content-root]"))).toEqual(
      metadataBefore
    );
    assertVisualContract(editorDiv);

    const callbackDocument = new DOMParser().parseFromString(changes[0], "text/html");
    const callbackRoot = requiredDirectChild(callbackDocument.body, "[data-rdx-content-root]");
    expect([...callbackRoot.attributes].map(attribute => attribute.name)).toEqual([
      "data-rdx-content-root"
    ]);
    expect(callbackDocument.querySelector("style")?.textContent).toBe(stylesheetText);
    expect(metadataInventory(callbackRoot)).toEqual(metadataBefore);
    expect(internalCarrierAttributes(callbackDocument)).toEqual([]);

    const persisted = sanitizer.normalizeHtml(changes[0]);
    const parsed = new DOMParser().parseFromString(persisted, "text/html");
    expect(parsed.querySelectorAll("style")).toHaveLength(1);
    expect(parsed.querySelector("style")?.textContent).toBe(stylesheetText);
    expect(directChildren(parsed.body, "[data-rdx-content-root]")).toHaveLength(1);
    expect(requiredElement<HTMLTableElement>(parsed, "#myTable1.pdf_table").rows).toHaveLength(12);
    expect(requiredElement(parsed, ".brick.heading").textContent).toBe("Tanım");
    expect(metadataInventory(requiredDirectChild(parsed.body, "[data-rdx-content-root]"))).toEqual(
      metadataBefore
    );
    expect(internalCarrierAttributes(parsed)).toEqual([]);
    expect(sanitizer.normalizeHtml(persisted)).toBe(persisted);
  });

  it("preserves canonical block class and id through a real Bold command", () => {
    const canonical = sanitizer.normalizeHtml(
      '<style>.notice{color:darkred}</style><p class="notice" id="message">alpha</p>'
    );
    const { host, mount, editorDiv } = createHost(canonical);
    const paragraph = requiredElement<HTMLParagraphElement>(editorDiv, "#message.notice");
    selectContents(getInstalledEditor(host), paragraph);
    const changes: string[] = [];
    host.onChange(nextHtml => changes.push(nextHtml));

    requiredElement<HTMLButtonElement>(mount, '[data-action="bold"]').click();

    expect(changes).toHaveLength(1);
    expect(directChildren(editorDiv, "style")).toHaveLength(1);
    expect(directChildren(editorDiv, "[data-rdx-content-root]")).toHaveLength(1);
    const changedParagraph = requiredElement<HTMLParagraphElement>(
      editorDiv,
      "#message.notice"
    );
    expect(changedParagraph.textContent).toBe("alpha");
    expect(getComputedStyle(changedParagraph).color).toBe("rgb(139, 0, 0)");
    expect(requiredElement(changedParagraph, "b,strong").textContent).toBe("alpha");
    expect(
      selectionIsContained(
        getInstalledEditor(host),
        requiredDirectChild(editorDiv, "[data-rdx-content-root]")
      )
    ).toBe(true);
    expect(internalCarrierAttributes(editorDiv)).toEqual([]);
    expect(internalCarrierAttributes(new DOMParser().parseFromString(changes[0], "text/html"))).toEqual(
      []
    );
  });

  it("preserves table section semantics when selected text is replaced", () => {
    const canonical = sanitizer.normalizeHtml(
      '<style>.report thead th{font-weight:700;text-align:left}.report tbody td{font-weight:300}</style>' +
        '<p id="replace-me">replace me</p>' +
        '<table class="report"><thead><tr><th>Heading</th></tr></thead>' +
        '<tbody><tr><td>Value</td></tr></tbody></table>'
    );
    const { host, editorDiv } = createHost(canonical);
    const editor = getInstalledEditor(host);
    selectContents(editor, requiredElement(editorDiv, "#replace-me"));
    const changes: string[] = [];
    host.onChange(nextHtml => changes.push(nextHtml));

    replaceSelectionWithText(host, "s");

    expect(changes).toHaveLength(1);
    const parsed = new DOMParser().parseFromString(host.getHtml(), "text/html");
    const table = requiredElement<HTMLTableElement>(parsed, "table.report");
    expect(table.querySelectorAll(":scope > thead")).toHaveLength(1);
    expect(table.querySelectorAll(":scope > tbody")).toHaveLength(1);
    expect(requiredElement(table, "thead th").textContent).toBe("Heading");
    expect(requiredElement(table, "tbody td").textContent).toBe("Value");
    expect(parsed.querySelector("style")?.textContent).toContain(
      "[data-rdx-content-root] .report thead th"
    );
  });

  it("delegates raw noncanonical metadata handling to installed Rooster defaults", () => {
    const raw =
      '<div class="raw-container"><p class="raw-paragraph" id="raw-id">alpha</p></div>';
    const { host, mount, editorDiv } = createHost(raw);
    selectContents(getInstalledEditor(host), requiredElement(editorDiv, "#raw-id"));

    requiredElement<HTMLButtonElement>(mount, '[data-action="bold"]').click();

    expect(host.getHtml()).toBe('<p id="raw-id"><b>alpha</b></p>');
  });

  it("makes only the active canonical logical root writable", () => {
    const canonical = sanitizer.normalizeHtml("<p>canonical</p>");
    const { host, editorDiv } = createHost(canonical);
    const canonicalRoot = requiredDirectChild<HTMLDivElement>(
      editorDiv,
      "[data-rdx-content-root]"
    );

    expect(editorDiv.contentEditable).toBe("false");
    expect(canonicalRoot.contentEditable).toBe("true");

    host.setReadOnly(true);
    expect(editorDiv.contentEditable).toBe("false");
    expect(canonicalRoot.contentEditable).toBe("false");

    host.setReadOnly(false);
    expect(editorDiv.contentEditable).toBe("false");
    expect(canonicalRoot.contentEditable).toBe("true");

    host.setHtml("<p>raw</p>");
    expect(editorDiv.contentEditable).toBe("true");
  });

  it("keeps the canonical root editable after a TableEdit cell-resize lifecycle", () => {
    const canonical = sanitizer.normalizeHtml(
      "<table><tbody><tr><td>cell</td></tr></tbody></table><p>continue editing</p>"
    );
    const { host, editorDiv } = createHost(canonical);
    const editor = getInstalledEditor(host);
    const canonicalRoot = requiredDirectChild<HTMLDivElement>(
      editorDiv,
      "[data-rdx-content-root]"
    );
    const table = requiredElement<HTMLTableElement>(canonicalRoot, "table");
    const tableEdit = getInstalledTableEditPlugin(editor);
    Object.defineProperty(table, "isContentEditable", {
      configurable: true,
      value: true
    });
    const entry = tableEdit
      .tableSelector(editor.getDOMHelper())
      .find(candidate => candidate.table === table);
    if (!entry) {
      throw new Error("Expected the installed TableEdit selector to find the table");
    }

    tableEdit.setTableEditor(entry);
    const tableEditor = tableEdit.tableEditor;
    if (!tableEditor) {
      throw new Error("Expected TableEdit to create a table editor");
    }

    tableEditor.onStartCellResize();
    tableEditor.onFinishEditing();

    expect.soft(editorDiv.contentEditable).toBe("false");
    expect(canonicalRoot.contentEditable).toBe("true");
  });

  it("names the active editor across canonical, raw, and read-only transitions", () => {
    const first = sanitizer.normalizeHtml("<p>first</p>");
    const second = sanitizer.normalizeHtml("<p>second</p>");
    const { host, editorDiv } = createHost(first);
    const firstRoot = requiredDirectChild<HTMLDivElement>(
      editorDiv,
      "[data-rdx-content-root]"
    );

    expect.soft(editorDiv.getAttribute("aria-label")).toBeNull();
    expect.soft(firstRoot.getAttribute("aria-label")).toBe("Description editor");

    host.setReadOnly(true);
    expect.soft(editorDiv.getAttribute("aria-label")).toBeNull();
    expect.soft(firstRoot.getAttribute("aria-label")).toBe("Description editor");

    host.setHtml("<p>raw</p>");
    expect.soft(editorDiv.getAttribute("aria-label")).toBe("Description editor");
    expect.soft(directChildren(editorDiv, "[data-rdx-content-root]")).toHaveLength(0);

    host.setReadOnly(false);
    expect.soft(editorDiv.getAttribute("aria-label")).toBe("Description editor");

    host.setHtml(second);
    const secondRoot = requiredDirectChild<HTMLDivElement>(
      editorDiv,
      "[data-rdx-content-root]"
    );
    expect.soft(editorDiv.getAttribute("aria-label")).toBeNull();
    expect.soft(secondRoot.getAttribute("aria-label")).toBe("Description editor");

    host.setReadOnly(true);
    expect.soft(editorDiv.getAttribute("aria-label")).toBeNull();
    expect.soft(secondRoot.getAttribute("aria-label")).toBe("Description editor");
  });

  it("keeps the canonical editor label out of public HTML without stripping author labels", () => {
    const canonical =
      '<div data-rdx-content-root><p aria-label="Author paragraph">alpha</p></div>';
    const { host, editorDiv } = createHost(canonical);
    const liveRoot = requiredDirectChild<HTMLDivElement>(
      editorDiv,
      "[data-rdx-content-root]"
    );
    const publicDocument = new DOMParser().parseFromString(host.getHtml(), "text/html");
    const publicRoot = requiredDirectChild<HTMLDivElement>(
      publicDocument.body,
      "[data-rdx-content-root]"
    );

    expect.soft(liveRoot.getAttribute("aria-label")).toBe("Description editor");
    expect.soft(publicRoot.hasAttribute("aria-label")).toBe(false);
    expect.soft(requiredElement(publicRoot, "p").getAttribute("aria-label")).toBe(
      "Author paragraph"
    );

    const changes: string[] = [];
    host.onChange(nextHtml => changes.push(nextHtml));
    const paragraph = requiredElement<HTMLParagraphElement>(liveRoot, "p");
    paragraph.textContent = "beta";
    paragraph.dispatchEvent(
      new InputEvent("input", { bubbles: true, data: "beta", inputType: "insertText" })
    );

    expect.soft(changes).toHaveLength(1);
    const callbackDocument = new DOMParser().parseFromString(changes[0] ?? "", "text/html");
    const callbackRoot = requiredDirectChild<HTMLDivElement>(
      callbackDocument.body,
      "[data-rdx-content-root]"
    );
    expect.soft(callbackRoot.hasAttribute("aria-label")).toBe(false);
    expect.soft(requiredElement(callbackRoot, "p").getAttribute("aria-label")).toBe(
      "Author paragraph"
    );
    expect.soft(liveRoot.getAttribute("aria-label")).toBe("Description editor");
  });

  it("does not inherit format-container metadata into generated descendants", () => {
    const canonical = sanitizer.normalizeHtml(
      '<pre class="code-sample" id="sample">alpha</pre>'
    );
    const { host, mount, editorDiv } = createHost(canonical);
    const canonicalRoot = requiredDirectChild(editorDiv, "[data-rdx-content-root]");
    const metadataBefore = metadataInventory(canonicalRoot);
    selectContents(getInstalledEditor(host), requiredElement(editorDiv, "#sample.code-sample"));

    requiredElement<HTMLButtonElement>(mount, '[data-action="bold"]').click();

    expect(requiredElement(editorDiv, "#sample.code-sample").textContent).toBe("alpha");
    expect(metadataInventory(requiredDirectChild(editorDiv, "[data-rdx-content-root]"))).toEqual(
      metadataBefore
    );
  });

  it("rejects carrier spoofing and replaces the logical root safely on repeated loads", () => {
    const first = sanitizer
      .normalizeHtml('<style>.real{color:darkred}</style><div class="real" id="first">one</div>')
      .replace(
        'id="first"',
        'id="first" data-rdx-editor-class="spoof" data-rdx-editor-id="evil"'
      );
    const second = sanitizer.normalizeHtml(
      '<style>.second{color:green}</style><p class="second" id="second">two</p>'
    );
    const { host, mount, editorDiv } = createHost(first);
    const firstRoot = requiredDirectChild<HTMLDivElement>(editorDiv, "[data-rdx-content-root]");
    const setLogicalRoot = vi.spyOn(getInstalledEditor(host), "setLogicalRoot");

    expect(first).toContain("data-rdx-editor-class");
    expect(host.getHtml()).not.toContain("data-rdx-editor-");
    expect(requiredElement(editorDiv, "#first.real").textContent).toBe("one");

    host.setHtml(second);

    const secondRoot = requiredDirectChild<HTMLDivElement>(editorDiv, "[data-rdx-content-root]");
    expect(setLogicalRoot.mock.calls).toEqual([[editorDiv], [secondRoot]]);
    expect(firstRoot.isConnected).toBe(false);
    expect(firstRoot.contentEditable).toBe("false");
    expect(secondRoot).not.toBe(firstRoot);
    expect(requiredElement(editorDiv, "#second.second").textContent).toBe("two");
    expect(host.getHtml()).toBe(second);
    secondRoot.setAttribute("contenteditable", "true");
    expect(host.getHtml()).toBe(second);
    secondRoot.removeAttribute("contenteditable");

    selectContents(getInstalledEditor(host), requiredElement(editorDiv, "#second.second"));
    const changes: string[] = [];
    host.onChange(nextHtml => changes.push(nextHtml));
    requiredElement<HTMLButtonElement>(mount, '[data-action="bold"]').click();

    expect(changes).toHaveLength(1);
    expect(changes[0]).not.toContain("data-rdx-editor-");
    expect(requiredElement(editorDiv, "#second.second b,#second.second strong").textContent).toBe(
      "two"
    );

    host.setReadOnly(true);
    expect(editorDiv.contentEditable).toBe("false");
    expect(secondRoot.contentEditable).toBe("false");
    host.setReadOnly(false);
    expect(editorDiv.contentEditable).toBe("false");
    expect(secondRoot.contentEditable).toBe("true");
  });

  it("keeps canonical metadata and a contained selection through real undo and redo", () => {
    const canonical = sanitizer.normalizeHtml(
      '<style>.notice{color:darkred}</style><p class="notice" id="message">alpha</p>'
    );
    const { host, mount, editorDiv } = createHost(canonical);
    const editor = getInstalledEditor(host);
    selectContents(editor, requiredElement(editorDiv, "#message.notice"));
    const changes: string[] = [];
    host.onChange(nextHtml => changes.push(nextHtml));

    requiredElement<HTMLButtonElement>(mount, '[data-action="bold"]').click();
    requiredElement<HTMLButtonElement>(mount, '[data-action="undo"]').click();

    expect(requiredElement(editorDiv, "#message.notice").textContent).toBe("alpha");
    expect(editorDiv.querySelector("#message.notice b,#message.notice strong")).toBeNull();
    expect(directChildren(editorDiv, "style")).toHaveLength(1);
    expect(requiredDirectChild(editorDiv, "style").textContent).toContain(
      "[data-rdx-content-root] .notice"
    );
    expect(host.getHtml()).toBe(canonical);
    expect(directChildren(editorDiv, "[data-rdx-content-root]")).toHaveLength(1);
    expect(
      selectionIsContained(
        editor,
        requiredDirectChild(editorDiv, "[data-rdx-content-root]")
      )
    ).toBe(true);

    requiredElement<HTMLButtonElement>(mount, '[data-action="redo"]').click();

    expect(requiredElement(editorDiv, "#message.notice b,#message.notice strong").textContent).toBe(
      "alpha"
    );
    expect(directChildren(editorDiv, "style")).toHaveLength(1);
    expect(requiredDirectChild(editorDiv, "style").textContent).toContain(
      "[data-rdx-content-root] .notice"
    );
    expect(directChildren(editorDiv, "[data-rdx-content-root]")).toHaveLength(1);
    expect(
      selectionIsContained(
        editor,
        requiredDirectChild(editorDiv, "[data-rdx-content-root]")
      )
    ).toBe(true);
    expect(changes).toHaveLength(3);
    expect(changes.every(html => !html.includes("data-rdx-editor-"))).toBe(true);
  });
});

function createHost(html: string): {
  host: RoosterHost;
  mount: HTMLDivElement;
  editorDiv: HTMLDivElement;
} {
  const mount = document.createElement("div");
  document.body.appendChild(mount);
  const host = new RoosterHost(mount, {
    enableMarkdownAutoformat: false,
    enableCodeBlock: false
  });
  disposables.push(() => host.dispose());
  host.setHtml(html);
  return {
    host,
    mount,
    editorDiv: requiredElement<HTMLDivElement>(mount, ".rdx-editor")
  };
}

function getInstalledEditor(host: RoosterHost): IEditor {
  return (host as unknown as { editor: IEditor }).editor;
}

type InstalledTableEntry = {
  table: HTMLTableElement;
  logicalRoot: HTMLDivElement | null;
};

type InstalledTableEditPlugin = {
  getName(): string;
  tableSelector(domHelper: DOMHelper): InstalledTableEntry[];
  setTableEditor(entry: InstalledTableEntry): void;
  tableEditor: {
    onStartCellResize(): void;
    onFinishEditing(): boolean;
  } | null;
};

function getInstalledTableEditPlugin(editor: IEditor): InstalledTableEditPlugin {
  const plugins = (
    editor as unknown as {
      core: { plugins: Array<{ getName(): string }> };
    }
  ).core.plugins;
  const plugin = plugins.find(candidate => candidate.getName() === "TableEdit");
  if (!plugin) {
    throw new Error("Missing installed TableEdit plugin");
  }
  return plugin as InstalledTableEditPlugin;
}

function selectContents(editor: IEditor, element: Element): void {
  const range = document.createRange();
  range.selectNodeContents(element);
  editor.setDOMSelection({ type: "range", range, isReverted: false });
}

function replaceSelectionWithText(host: RoosterHost, replacement: string): void {
  const editor = getInstalledEditor(host);
  const editorDiv = requiredElement<HTMLDivElement>(document, ".rdx-editor");
  const canonicalRoot = requiredDirectChild<HTMLDivElement>(
    editorDiv,
    "[data-rdx-content-root]"
  );
  canonicalRoot.dispatchEvent(
    new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: replacement
    })
  );

  const selection = editor.getDOMSelection();
  if (selection?.type !== "range") {
    throw new Error("Expected a range selection after Rooster keyboard handling");
  }
  selection.range.deleteContents();
  const text = document.createTextNode(replacement);
  selection.range.insertNode(text);
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

function selectionIsContained(editor: IEditor, root: HTMLElement): boolean {
  editor.focus();
  const selection = editor.getDOMSelection();
  switch (selection?.type) {
    case "range":
      return root.contains(selection.range.commonAncestorContainer);
    case "table":
      return root.contains(selection.table);
    case "image":
      return root.contains(selection.image);
    default:
      return false;
  }
}

function pressMenuKey(key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key });
  document.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  return event;
}

function assertVisualContract(editorDiv: HTMLDivElement): void {
  const heading = requiredElement<HTMLElement>(editorDiv, ".brick.heading");
  const table = requiredElement<HTMLTableElement>(editorDiv, "#myTable1.pdf_table");
  const cell = requiredElement<HTMLTableCellElement>(table, "td");

  expect(heading.textContent).toBe("Tanım");
  expect(getComputedStyle(heading).color).toBe("rgb(139, 0, 0)");
  expect(getComputedStyle(table).borderTopWidth).toBe("1px");
  expect(getComputedStyle(table).borderTopStyle).toBe("solid");
  expect(getComputedStyle(cell).borderTopWidth).toBe("1px");
  expect(getComputedStyle(cell).borderTopStyle).toBe("solid");
}

function requiredDirectChild<T extends Element = HTMLElement>(
  root: ParentNode,
  selector: string
): T {
  const element = directChildren(root, selector)[0];
  if (!element) {
    throw new Error(`Missing direct ${selector} fixture`);
  }
  return element as unknown as T;
}

function directChildren<T extends Element = HTMLElement>(root: ParentNode, selector: string): T[] {
  return [...root.children].filter(child => child.matches(selector)) as T[];
}

function requiredElement<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const element = root.querySelector(selector);
  if (!element) {
    throw new Error(`Missing ${selector} fixture`);
  }
  return element as T;
}

function internalCarrierAttributes(root: ParentNode): string[] {
  return [...root.querySelectorAll("*")].flatMap(element =>
    [...element.attributes]
      .map(attribute => attribute.name)
      .filter(name => name.startsWith("data-rdx-editor-"))
  );
}

function metadataInventory(root: ParentNode): string[] {
  return [...root.querySelectorAll("*")]
    .flatMap(element => {
      const metadata: string[] = [];
      if (element.hasAttribute("class")) {
        metadata.push(`class:${element.getAttribute("class")}`);
      }
      if (element.hasAttribute("id")) {
        metadata.push(`id:${element.getAttribute("id")}`);
      }
      return metadata;
    })
    .sort();
}
