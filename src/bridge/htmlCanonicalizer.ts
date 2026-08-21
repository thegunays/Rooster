import createDOMPurify from "dompurify";

const ROOT_ATTRIBUTE = "data-rdx-content-root";
const MAX_TEMPLATE_CSS_LENGTH = 100_000;
const EMPTY_CANONICAL_HTML = `<div ${ROOT_ATTRIBUTE}=""></div>`;
const CSS_POLICY_FAILURE_CODE = "RDX_SANITIZER_CSS_POLICY_FAILURE";
const HTML_FAILURE_CODE = "RDX_SANITIZER_HTML_FAILURE";

const FORBIDDEN_TAGS = [
  "style",
  "head",
  "title",
  "script",
  "iframe",
  "object",
  "embed",
  "link",
  "meta",
  "form",
  "input",
  "button",
  "textarea",
  "template"
];

export interface CanonicalCssPolicy {
  normalizeDeclarationList(value: string): string;
  normalizeStylesheet(value: string): string;
}

interface NormalizedInlineStyle {
  element: HTMLElement;
  value: string;
}

export function canonicalizeHtml(
  value: string | null | undefined,
  cssPolicy: CanonicalCssPolicy
): string {
  try {
    const parser = new DOMParser();
    const parsedDocument = parser.parseFromString(value ?? "", "text/html");
    const stylesheetText = extractStyles(parsedDocument);
    const domPurify = createDOMPurify(window);
    const sanitizedMarkup = String(
      domPurify.sanitize(parsedDocument.body.innerHTML, {
        USE_PROFILES: { html: true },
        FORBID_TAGS: FORBIDDEN_TAGS,
        ADD_ATTR: ["style"]
      })
    );

    const container = parsedDocument.createElement("div");
    container.innerHTML = sanitizedMarkup;
    unwrapReservedRoots(container);

    const inlineStyleCount = container.querySelectorAll("[style]").length;
    let canonicalStylesheet = "";
    try {
      const normalizedCss = normalizeCssTransaction(container, stylesheetText, cssPolicy);
      applyNormalizedInlineStyles(normalizedCss.inlineStyles);
      canonicalStylesheet = normalizedCss.stylesheet;
    } catch {
      discardInlineStyles(container);
      logControlledWarning(
        CSS_POLICY_FAILURE_CODE,
        stylesheetText.length + inlineStyleCount
      );
    }
    sortAttributes(container);

    const root = parsedDocument.createElement("div");
    root.setAttribute(ROOT_ATTRIBUTE, "");
    root.append(...Array.from(container.childNodes));

    const stylePrefix = canonicalStylesheet
      ? `<style>${encodeStyleRawText(canonicalStylesheet)}</style>`
      : "";
    return `${stylePrefix}${root.outerHTML}`;
  } catch {
    logControlledWarning(HTML_FAILURE_CODE);
    return EMPTY_CANONICAL_HTML;
  }
}

function encodeStyleRawText(stylesheet: string): string {
  return stylesheet.replace(/</g, "\\3c ");
}

function extractStyles(document: Document): string[] {
  const styles = Array.from(document.querySelectorAll("style"), style => style.textContent ?? "");
  document.querySelectorAll("style").forEach(style => style.remove());
  return styles;
}

function normalizeExtractedStyles(
  styles: readonly string[],
  cssPolicy: CanonicalCssPolicy
): string {
  const aggregateLength = styles.reduce((length, style) => length + style.length, 0);
  if (aggregateLength > MAX_TEMPLATE_CSS_LENGTH || styles.length === 0) {
    return "";
  }

  return cssPolicy.normalizeStylesheet(styles.join("\n"));
}

function unwrapReservedRoots(container: HTMLElement): void {
  const roots = Array.from(container.querySelectorAll(`[${ROOT_ATTRIBUTE}]`));
  for (const root of roots) {
    root.replaceWith(...Array.from(root.childNodes));
  }
}

function normalizeCssTransaction(
  container: HTMLElement,
  styles: readonly string[],
  cssPolicy: CanonicalCssPolicy
): { inlineStyles: NormalizedInlineStyle[]; stylesheet: string } {
  const inlineStyles = Array.from(
    container.querySelectorAll<HTMLElement>("[style]"),
    element => ({
      element,
      value: cssPolicy.normalizeDeclarationList(element.getAttribute("style") ?? "")
    })
  );
  const stylesheet = normalizeExtractedStyles(styles, cssPolicy);
  return { inlineStyles, stylesheet };
}

function applyNormalizedInlineStyles(styles: readonly NormalizedInlineStyle[]): void {
  for (const style of styles) {
    if (style.value) {
      style.element.setAttribute("style", style.value);
    } else {
      style.element.removeAttribute("style");
    }
  }
}

function discardInlineStyles(container: HTMLElement): void {
  container.querySelectorAll("[style]").forEach(element => element.removeAttribute("style"));
}

function logControlledWarning(code: string, count?: number): void {
  try {
    if (count === undefined) {
      console.warn(code);
    } else {
      console.warn(code, count);
    }
  } catch {
    // Logging must never weaken the sanitizer's safe fallback.
  }
}

function sortAttributes(container: HTMLElement): void {
  for (const element of Array.from(container.querySelectorAll("*"))) {
    const attributes = Array.from(element.attributes, attribute => [attribute.name, attribute.value] as const)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);

    for (const attribute of Array.from(element.attributes)) {
      element.removeAttribute(attribute.name);
    }
    for (const [name, value] of attributes) {
      element.setAttribute(name, value);
    }
  }
}
