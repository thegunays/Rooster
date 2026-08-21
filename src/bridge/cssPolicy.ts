import * as cssTree from "css-tree";
import type {
  Atrule,
  AttributeSelector,
  Block,
  CssNode,
  Declaration,
  DeclarationList,
  Rule,
  Selector
} from "css-tree";

const ROOT_ATTRIBUTE = "data-rdx-content-root";
const DOCUMENT_ROOT_TYPES = new Set(["html", "body"]);
const ALLOWED_PSEUDO_CLASSES = new Set(["hover", "first-child", "last-child", "nth-child"]);
const ALLOWED_PROPERTIES = new Set([
  "font",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "line-height",
  "color",
  "text-align",
  "vertical-align",
  "text-decoration",
  "white-space",
  "width",
  "min-width",
  "max-width",
  "height",
  "min-height",
  "max-height",
  "box-sizing",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "border",
  "border-width",
  "border-style",
  "border-color",
  "border-top",
  "border-top-width",
  "border-top-style",
  "border-top-color",
  "border-right",
  "border-right-width",
  "border-right-style",
  "border-right-color",
  "border-bottom",
  "border-bottom-width",
  "border-bottom-style",
  "border-bottom-color",
  "border-left",
  "border-left-width",
  "border-left-style",
  "border-left-color",
  "border-collapse",
  "border-spacing",
  "border-radius",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-right-radius",
  "border-bottom-left-radius",
  "background-color",
  "background",
  "display",
  "position",
  "overflow",
  "overflow-x",
  "overflow-y",
  "float",
  "clear",
  "flex-basis",
  "flex-grow",
  "flex-shrink",
  "list-style",
  "list-style-type",
  "list-style-position",
  "transition"
]);
const ALLOWED_DISPLAY_VALUES = new Set([
  "none",
  "block",
  "inline",
  "inline-block",
  "flow-root",
  "list-item",
  "flex",
  "inline-flex",
  "table",
  "inline-table",
  "table-row-group",
  "table-header-group",
  "table-footer-group",
  "table-row",
  "table-column-group",
  "table-column",
  "table-cell",
  "table-caption"
]);
const FORBIDDEN_VALUE_WORDS = new Set([
  "javascript",
  "vbscript",
  "behavior",
  "-moz-binding"
]);
const FORBIDDEN_FUNCTIONS = new Set(["url", "var", "expression"]);
const ALLOWED_VALUE_FUNCTIONS = new Set([
  "calc",
  "min",
  "max",
  "fit-content",
  "rgb",
  "rgba",
  "hsl",
  "hsla",
  "cubic-bezier",
  "steps"
]);

export function normalizeStylesheet(value: string): string {
  const stylesheet = parseCss(value, "stylesheet", true);
  if (!stylesheet || stylesheet.type !== "StyleSheet") {
    return "";
  }

  const acceptedRules: CssNode[] = [];
  for (const node of stylesheet.children) {
    if (node.type === "Rule") {
      const acceptedRule = normalizeRule(node);
      if (acceptedRule) {
        acceptedRules.push(acceptedRule);
      }
    } else if (node.type === "Atrule") {
      const acceptedAtrule = normalizeAtrule(node);
      if (acceptedAtrule) {
        acceptedRules.push(acceptedAtrule);
      }
    }
  }

  stylesheet.children = new cssTree.List<CssNode>().fromArray(acceptedRules);
  return cssTree.generate(stylesheet);
}

export function normalizeDeclarationList(value: string): string {
  const declarations = parseCss(value, "declarationList", true);
  if (!declarations || declarations.type !== "DeclarationList") {
    return "";
  }
  filterDeclarationList(declarations);
  return cssTree.generate(declarations);
}

function parseCss(value: string, context: string, recover = false): CssNode | null {
  try {
    return cssTree.parse(value, {
      context,
      onParseError: recover
        ? undefined
        : error => {
            throw error;
          }
    });
  } catch {
    return null;
  }
}

function normalizeRule(rule: Rule): Rule | null {
  filterDeclarationBlock(rule.block);
  if (rule.block.children.isEmpty) {
    return null;
  }

  const selectorSource = rule.prelude.type === "Raw"
    ? rule.prelude.value
    : cssTree.generate(rule.prelude);
  const acceptedSelectors = splitSelectorBranches(selectorSource)
    .map(parseAndTransformSelector)
    .filter((selector): selector is Selector => selector !== null);

  if (acceptedSelectors.length === 0) {
    return null;
  }

  rule.prelude = {
    type: "SelectorList",
    children: new cssTree.List<CssNode>().fromArray(acceptedSelectors)
  };
  return rule;
}

function normalizeAtrule(atrule: Atrule): Atrule | null {
  if (
    atrule.name.toLowerCase() !== "media" ||
    !atrule.prelude ||
    cssTree.generate(atrule.prelude).trim() !== "print" ||
    !atrule.block
  ) {
    return null;
  }

  const acceptedRules: CssNode[] = [];
  for (const child of atrule.block.children) {
    if (child.type === "Rule") {
      const acceptedRule = normalizeRule(child);
      if (acceptedRule) {
        acceptedRules.push(acceptedRule);
      }
    }
  }
  if (acceptedRules.length === 0) {
    return null;
  }

  atrule.name = "media";
  atrule.block.children = new cssTree.List<CssNode>().fromArray(acceptedRules);
  return atrule;
}

function filterDeclarationList(declarations: DeclarationList): void {
  const accepted = Array.from(declarations.children)
    .filter((node): node is Declaration => node.type === "Declaration")
    .filter(isAllowedDeclaration);
  declarations.children = new cssTree.List<CssNode>().fromArray(accepted);
}

function filterDeclarationBlock(block: Block): void {
  const accepted = Array.from(block.children)
    .filter((node): node is Declaration => node.type === "Declaration")
    .filter(isAllowedDeclaration);
  block.children = new cssTree.List<CssNode>().fromArray(accepted);
}

function isAllowedDeclaration(declaration: Declaration): boolean {
  const property = declaration.property.toLowerCase();
  declaration.property = property;
  if (!ALLOWED_PROPERTIES.has(property) || declaration.value.type === "Raw") {
    return false;
  }
  if (!cssTree.lexer.matchProperty(property, declaration.value).matched) {
    return false;
  }
  if (containsForbiddenValue(declaration.value)) {
    return false;
  }

  const generatedValue = cssTree.generate(declaration.value);
  if (property === "position" && generatedValue !== "static" && generatedValue !== "relative") {
    return false;
  }
  if (property === "display" && !ALLOWED_DISPLAY_VALUES.has(generatedValue)) {
    return false;
  }
  if (property === "background") {
    return generatedValue === "none" || cssTree.lexer.matchType("color", declaration.value).matched !== null;
  }
  return true;
}

function containsForbiddenValue(value: CssNode): boolean {
  let forbidden = false;
  cssTree.walk(value, node => {
    const decodedFunctionName = node.type === "Function"
      ? cssTree.ident.decode(node.name).toLowerCase()
      : "";
    const decodedIdentifier = node.type === "Identifier"
      ? cssTree.ident.decode(node.name).toLowerCase()
      : "";
    if (
      node.type === "Raw" ||
      node.type === "Url" ||
      (node.type === "Function" &&
        (FORBIDDEN_FUNCTIONS.has(decodedFunctionName) ||
          !ALLOWED_VALUE_FUNCTIONS.has(decodedFunctionName))) ||
      (node.type === "Identifier" &&
        (decodedIdentifier.startsWith("--") || FORBIDDEN_VALUE_WORDS.has(decodedIdentifier)))
    ) {
      forbidden = true;
    }
  });
  return forbidden;
}

function parseAndTransformSelector(value: string): Selector | null {
  const parsed = parseCss(value.trim(), "selector");
  if (!parsed || parsed.type !== "Selector" || !isAllowedSelector(parsed)) {
    return null;
  }

  const nodes = parsed.children.toArray();
  if (nodes[0]?.type === "Combinator") {
    return null;
  }
  const markerIndices = nodes
    .map((node, index) => isRootMarker(node) ? index : -1)
    .filter(index => index >= 0);
  const anyMarkerIndices = nodes
    .map((node, index) => isAnyRootMarkerAttribute(node) ? index : -1)
    .filter(index => index >= 0);
  const documentRootIndices = nodes
    .map((node, index) => isDocumentRoot(node) ? index : -1)
    .filter(index => index >= 0);

  if (anyMarkerIndices.length > 0) {
    if (
      anyMarkerIndices.length !== 1 ||
      markerIndices.length !== 1 ||
      markerIndices[0] !== 0 ||
      documentRootIndices.length > 0 ||
      escapesRootCompound(nodes)
    ) {
      return null;
    }
    return parsed;
  }

  if (documentRootIndices.length === 0) {
    parsed.children = new cssTree.List<CssNode>().fromArray([
      createRootMarker(),
      createDescendantCombinator(),
      ...nodes
    ]);
    return reparsedSelector(parsed);
  }

  if (documentRootIndices[0] !== 0) {
    return null;
  }

  let lastLeadingRootIndex = 0;
  while (lastLeadingRootIndex + 2 < nodes.length) {
    const combinator = nodes[lastLeadingRootIndex + 1];
    const nextCompoundStart = nodes[lastLeadingRootIndex + 2];
    if (combinator.type !== "Combinator" || !isDocumentRoot(nextCompoundStart)) {
      break;
    }
    lastLeadingRootIndex += 2;
  }

  for (let index = 0; index <= lastLeadingRootIndex; index += 2) {
    if (!isDocumentRoot(nodes[index])) {
      return null;
    }
    if (index < lastLeadingRootIndex && nodes[index + 1]?.type !== "Combinator") {
      return null;
    }
  }

  const firstContentIndex = lastLeadingRootIndex + 1;
  const remainingNodes = nodes.slice(firstContentIndex);
  if (
    remainingNodes.some(node => isDocumentRoot(node) || isAnyRootMarkerAttribute(node)) ||
    (remainingNodes.length > 0 && remainingNodes[0].type !== "Combinator") ||
    (remainingNodes[0]?.type === "Combinator" && !isContainedCombinator(remainingNodes[0]))
  ) {
    return null;
  }

  parsed.children = new cssTree.List<CssNode>().fromArray([
    createRootMarker(),
    ...remainingNodes
  ]);
  return reparsedSelector(parsed);
}

function reparsedSelector(selector: Selector): Selector | null {
  const parsed = parseCss(cssTree.generate(selector), "selector");
  return parsed?.type === "Selector" ? parsed : null;
}

function isAllowedSelector(selector: Selector): boolean {
  for (const node of selector.children) {
    switch (node.type) {
      case "TypeSelector":
      case "ClassSelector":
      case "IdSelector":
      case "Combinator":
        break;
      case "AttributeSelector":
        if (!isStaticAttribute(node)) {
          return false;
        }
        break;
      case "PseudoClassSelector":
        if (
          !(node.name.toLowerCase() === "root" && node.children === null) &&
          !isAllowedPseudoClass(node)
        ) {
          return false;
        }
        break;
      default:
        return false;
    }
  }
  return true;
}

function isStaticAttribute(node: AttributeSelector): boolean {
  return node.name.type === "Identifier" &&
    (node.value === null || node.value.type === "Identifier" || node.value.type === "String");
}

function isAllowedPseudoClass(node: Extract<CssNode, { type: "PseudoClassSelector" }>): boolean {
  const name = node.name.toLowerCase();
  if (!ALLOWED_PSEUDO_CLASSES.has(name)) {
    return false;
  }
  if (name !== "nth-child") {
    return node.children === null;
  }
  if (!node.children || node.children.size !== 1 || node.children.first?.type !== "Nth") {
    return false;
  }
  return node.children.first.selector === null;
}

function isDocumentRoot(node: CssNode): boolean {
  return (node.type === "TypeSelector" && DOCUMENT_ROOT_TYPES.has(node.name.toLowerCase())) ||
    (node.type === "PseudoClassSelector" && node.name.toLowerCase() === "root" && node.children === null);
}

function isAnyRootMarkerAttribute(node: CssNode): node is AttributeSelector {
  return node.type === "AttributeSelector" && node.name.name.toLowerCase() === ROOT_ATTRIBUTE;
}

function isRootMarker(node: CssNode): node is AttributeSelector {
  return isAnyRootMarkerAttribute(node) && node.matcher === null && node.value === null && node.flags === null;
}

function createRootMarker(): AttributeSelector {
  return {
    type: "AttributeSelector",
    name: { type: "Identifier", name: ROOT_ATTRIBUTE },
    matcher: null,
    value: null,
    flags: null
  };
}

function createDescendantCombinator(): CssNode {
  return { type: "Combinator", name: " " };
}

function escapesRootCompound(nodes: readonly CssNode[]): boolean {
  const firstCombinator = nodes.find(node => node.type === "Combinator");
  return firstCombinator?.type === "Combinator" && !isContainedCombinator(firstCombinator);
}

function isContainedCombinator(combinator: Extract<CssNode, { type: "Combinator" }>): boolean {
  return combinator.name === " " || combinator.name === ">";
}

function splitSelectorBranches(value: string): string[] {
  const branches: string[] = [];
  let start = 0;
  let parentheses = 0;
  let brackets = 0;
  let quote: "\"" | "'" | null = null;
  let inComment = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const next = value[index + 1];

    if (inComment) {
      if (character === "*" && next === "/") {
        inComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (character === "\\") {
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === "/" && next === "*") {
      inComment = true;
      index += 1;
    } else if (character === "\"" || character === "'") {
      quote = character;
    } else if (character === "\\") {
      index += 1;
    } else if (character === "(") {
      parentheses += 1;
    } else if (character === ")") {
      parentheses -= 1;
    } else if (character === "[") {
      brackets += 1;
    } else if (character === "]") {
      brackets -= 1;
    } else if (character === "," && parentheses === 0 && brackets === 0) {
      branches.push(value.slice(start, index));
      start = index + 1;
    }

    if (parentheses < 0 || brackets < 0) {
      return [];
    }
  }

  if (quote || inComment || parentheses !== 0 || brackets !== 0) {
    return [];
  }
  branches.push(value.slice(start));
  return branches.filter(branch => branch.trim().length > 0);
}
