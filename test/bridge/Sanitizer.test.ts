import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as cssTree from "css-tree";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sanitizer } from "../../src/bridge/Sanitizer";
import {
  canonicalizeHtml,
  type CanonicalCssPolicy
} from "../../src/bridge/htmlCanonicalizer";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Sanitizer HTML boundary", () => {
  const normalize = (value: string | null | undefined): string =>
    new Sanitizer().normalizeHtml(value);

  it("wraps ordinary rich HTML in one fresh canonical content root", () => {
    expect(normalize("<p>hello</p>")).toBe(
      '<div data-rdx-content-root=""><p>hello</p></div>'
    );
  });

  it("returns the empty canonical wrapper for nullish, empty, or wholly unsafe input", () => {
    expect(normalize(null)).toBe('<div data-rdx-content-root=""></div>');
    expect(normalize(undefined)).toBe('<div data-rdx-content-root=""></div>');
    expect(normalize("")).toBe('<div data-rdx-content-root=""></div>');
    expect(normalize("<script>alert(1)</script>")).toBe(
      '<div data-rdx-content-root=""></div>'
    );
  });

  it("removes executable and interactive elements and event handlers", () => {
    const input =
      '<p onclick="evil()" onmouseover="evil()">safe</p>' +
      '<script>alert(1)</script><iframe src="https://example.com"></iframe>' +
      "<object></object><embed><form></form><input><button></button><textarea></textarea>";

    expect(normalize(input)).toBe(
      '<div data-rdx-content-root=""><p>safe</p></div>'
    );
  });

  it("preserves HTTPS anchors while removing unsafe URI attributes", () => {
    const input =
      '<a href="https://example.com/path?q=1">safe</a>' +
      '<a href="javascript:alert(1)">bad</a>' +
      '<img alt="x" src="vbscript:evil">';

    expect(normalize(input)).toBe(
      '<div data-rdx-content-root=""><a href="https://example.com/path?q=1">safe</a><a>bad</a><img alt="x"></div>'
    );
  });

  it("unwraps every input marker and never inherits marker attributes", () => {
    const input =
      '<div data-rdx-content-root="attacker" id="outer" class="wide" style="position:fixed" onclick="evil()">' +
      '<p>one</p><section><div data-rdx-content-root="" id="inner">two</div></section>' +
      "</div>";

    expect(normalize(input)).toBe(
      '<div data-rdx-content-root=""><p>one</p><section>two</section></div>'
    );
  });

  it("sorts ordinary HTML attributes lexicographically by normalized name", () => {
    const input =
      '<P title="tip" ID="p" data-z="z" CLASS="lead" aria-label="intro" data-a="a">x</P>';

    expect(normalize(input)).toBe(
      '<div data-rdx-content-root=""><p aria-label="intro" class="lead" data-a="a" data-z="z" id="p" title="tip">x</p></div>'
    );
  });

  it("preserves expected editor structures while sanitizing their attributes", () => {
    const input =
      '<table class="grid"><tbody><tr><td colspan="2">A</td></tr></tbody></table>' +
      "<pre><code>const a = 1;</code></pre>";

    expect(normalize(input)).toBe(
      '<div data-rdx-content-root=""><table class="grid"><tbody><tr><td colspan="2">A</td></tr></tbody></table><pre><code>const a = 1;</code></pre></div>'
    );
  });

  it("does not let template content bypass root neutralization or inline CSS policy", () => {
    const input =
      '<section><template><div data-rdx-content-root="attacker" id="attacker" class="attacker" data-attacker="yes" ' +
      'style="position:fixed;background:url(https://example.com/x)" onclick="evil()">' +
      '<span style="position:fixed;background:url(https://example.com/y)">inside</span></div></template></section>' +
      "<p>outside</p>";
    const normalized = normalize(input);
    const reparsed = new DOMParser().parseFromString(normalized, "text/html");

    expect(normalized).toBe(
      '<div data-rdx-content-root=""><section></section><p>outside</p></div>'
    );
    expect(reparsed.querySelector("template")).toBeNull();
    expect((normalized.match(/data-rdx-content-root/g) ?? [])).toHaveLength(1);
    expect(normalized).not.toContain("position:fixed");
    expect(normalized).not.toContain("url(");
    expect(normalized).not.toContain("attacker");
    expect(normalized).not.toContain("onclick");
    expect(reparsed.body.textContent).toContain("outside");
  });
});

describe("Sanitizer stylesheet selector policy", () => {
  const normalize = (value: string): string => new Sanitizer().normalizeHtml(value);

  it("scopes ordinary selector branches to content descendants", () => {
    expect(normalize("<style>table{border:1px solid black}</style><table></table>")).toBe(
      '<style>[data-rdx-content-root] table{border:1px solid black}</style><div data-rdx-content-root=""><table></table></div>'
    );
  });

  it("collapses maximal leading document-root chains and preserves the final combinator", () => {
    const input =
      "<style>body > table{width:100%}html body .x{color:red}:root > *{box-sizing:border-box}html > body > .y{display:block}</style>" +
      '<table></table><p class="x y">x</p>';

    expect(normalize(input)).toBe(
      '<style>[data-rdx-content-root]>table{width:100%}[data-rdx-content-root] .x{color:red}[data-rdx-content-root]>*{box-sizing:border-box}[data-rdx-content-root]>.y{display:block}</style><div data-rdx-content-root=""><table></table><p class="x y">x</p></div>'
    );
  });

  it("keeps safe selector branches when sibling branches use escape constructs", () => {
    const input =
      "<style>table,:host,.ok,::part(label),::slotted(.x),:global(.escape){color:red}</style><p class=\"ok\">x</p>";

    expect(normalize(input)).toBe(
      '<style>[data-rdx-content-root] table,[data-rdx-content-root] .ok{color:red}</style><div data-rdx-content-root=""><p class="ok">x</p></div>'
    );
  });

  it("rejects leading relative combinators in ordinary rules without losing safe siblings", () => {
    const input =
      "<style>" +
      "+.rdx-status,.safe{color:red}" +
      "~.rdx-toolbar,.also-safe{font-weight:bold}" +
      ">.rdx-message,.third-safe{padding:1px}" +
      "</style>" +
      '<p class="safe also-safe third-safe">x</p>';
    const once = normalize(input);
    const expected =
      '<style>[data-rdx-content-root] .safe{color:red}' +
      '[data-rdx-content-root] .also-safe{font-weight:bold}' +
      '[data-rdx-content-root] .third-safe{padding:1px}</style>' +
      '<div data-rdx-content-root=""><p class="safe also-safe third-safe">x</p></div>';
    const reparsed = new DOMParser().parseFromString(
      once +
        '<div class="rdx-status"></div>' +
        '<div class="rdx-toolbar"></div>' +
        '<div class="rdx-message"></div>',
      "text/html"
    );
    const stylesheet = reparsed.querySelector("style")?.textContent ?? "";
    const stylesheetAst = cssTree.parse(stylesheet, { context: "stylesheet" });
    const selectors: string[] = [];
    cssTree.walk(stylesheetAst, {
      visit: "Selector",
      enter: selector => selectors.push(cssTree.generate(selector))
    });
    const externalSiblings = Array.from(
      reparsed.body.querySelectorAll<HTMLElement>(".rdx-status,.rdx-toolbar,.rdx-message")
    );

    expect(once).toBe(expected);
    expect(normalize(once)).toBe(expected);
    expect(selectors).toEqual([
      "[data-rdx-content-root] .safe",
      "[data-rdx-content-root] .also-safe",
      "[data-rdx-content-root] .third-safe"
    ]);
    expect(
      externalSiblings.every(element => selectors.every(selector => !element.matches(selector)))
    ).toBe(true);
  });

  it("rejects leading relative combinators inside print rules and remains byte-idempotent", () => {
    const input =
      "<style>@media print{" +
      "+.rdx-status,.safe{color:red}" +
      "~.rdx-toolbar,.also-safe{font-weight:bold}" +
      ">.rdx-message,.third-safe{padding:1px}" +
      "}</style>" +
      '<p class="safe also-safe third-safe">x</p>';
    const once = normalize(input);
    const expected =
      '<style>@media print{[data-rdx-content-root] .safe{color:red}' +
      '[data-rdx-content-root] .also-safe{font-weight:bold}' +
      '[data-rdx-content-root] .third-safe{padding:1px}}</style>' +
      '<div data-rdx-content-root=""><p class="safe also-safe third-safe">x</p></div>';
    const reparsed = new DOMParser().parseFromString(
      once +
        '<div class="rdx-status"></div>' +
        '<div class="rdx-toolbar"></div>' +
        '<div class="rdx-message"></div>',
      "text/html"
    );
    const stylesheet = reparsed.querySelector("style")?.textContent ?? "";
    const stylesheetAst = cssTree.parse(stylesheet, { context: "stylesheet" });
    const selectors: string[] = [];
    cssTree.walk(stylesheetAst, {
      visit: "Selector",
      enter: selector => selectors.push(cssTree.generate(selector))
    });
    const externalSiblings = Array.from(
      reparsed.body.querySelectorAll<HTMLElement>(".rdx-status,.rdx-toolbar,.rdx-message")
    );

    expect(once).toBe(expected);
    expect(normalize(once)).toBe(expected);
    expect(selectors).toEqual([
      "[data-rdx-content-root] .safe",
      "[data-rdx-content-root] .also-safe",
      "[data-rdx-content-root] .third-safe"
    ]);
    expect(
      externalSiblings.every(element => selectors.every(selector => !element.matches(selector)))
    ).toBe(true);
  });

  it("keeps one exact leading marker and rejects marker value or late-marker branches", () => {
    const input =
      '<style>[data-rdx-content-root] .kept,[data-rdx-content-root=""] .empty,[data-rdx-content-root="other"] .valued,' +
      '.late [data-rdx-content-root],[data-rdx-content-root]~.rdx-status,:root+.rdx-toolbar{color:red}</style><p class="kept">x</p>';

    expect(normalize(input)).toBe(
      '<style>[data-rdx-content-root] .kept{color:red}</style><div data-rdx-content-root=""><p class="kept">x</p></div>'
    );
  });

  it("rejects topology-dependent or late document roots without dropping safe siblings", () => {
    const input =
      "<style>body:first-child .bad,.x body,html::before,.safe{color:red}</style><p class=\"safe\">x</p>";

    expect(normalize(input)).toBe(
      '<style>[data-rdx-content-root] .safe{color:red}</style><div data-rdx-content-root=""><p class="safe">x</p></div>'
    );
  });

  it("allows only the fixture-required pseudo-classes and rejects malformed pseudo arguments", () => {
    const input =
      "<style>.x:hover,li:first-child,li:last-child,li:nth-child(2n+1),table:nth-child(foo){color:red}</style>" +
      '<ul><li class="x">x</li></ul>';

    expect(normalize(input)).toBe(
      '<style>[data-rdx-content-root] .x:hover,[data-rdx-content-root] li:first-child,[data-rdx-content-root] li:last-child,[data-rdx-content-root] li:nth-child(2n+1){color:red}</style><div data-rdx-content-root=""><ul><li class="x">x</li></ul></div>'
    );
  });

  it("does not add another scope marker when canonical CSS is normalized again", () => {
    const once = normalize("<style>.x{color:red}</style><p class=\"x\">x</p>");

    expect(normalize(once)).toBe(once);
    expect(once).toBe(
      '<style>[data-rdx-content-root] .x{color:red}</style><div data-rdx-content-root=""><p class="x">x</p></div>'
    );
  });
});

describe("Sanitizer declaration and at-rule policy", () => {
  const normalize = (value: string): string => new Sanitizer().normalizeHtml(value);

  it("preserves the approved typography, text, sizing, table, flex, list, and transition values", () => {
    const declarations =
      'font:italic 700 16px/1.4 Arial,sans-serif;font-family:"Times New Roman",serif;' +
      "font-size:12pt;font-style:italic;font-weight:600;line-height:1.3;" +
      "color:#253342;text-align:center;vertical-align:top;text-decoration:underline;white-space:pre-wrap;" +
      "width:100%;min-width:fit-content;max-width:1200px;height:auto;min-height:0;max-height:80vh;box-sizing:border-box;" +
      "display:inline-flex;position:relative;overflow:auto;overflow-x:hidden;overflow-y:auto;float:right;clear:both;" +
      "flex-basis:100%;flex-grow:1;flex-shrink:0;list-style:square inside;list-style-type:decimal;" +
      "list-style-position:outside;transition:color 200ms ease-in-out";

    expect(normalize(`<style>.safe{${declarations}}</style><p class="safe">x</p>`)).toBe(
      `<style>[data-rdx-content-root] .safe{${declarations}}</style><div data-rdx-content-root=""><p class="safe">x</p></div>`
    );
  });

  it("preserves approved spacing, border, and color-only background declarations in source order", () => {
    const declarations =
      "margin:1px 2px 3px 4px;margin-top:1px;margin-right:2px;margin-bottom:3px;margin-left:4px;" +
      "padding:5px 6px;padding-top:5px;padding-right:6px;padding-bottom:7px;padding-left:8px;" +
      "border:1px solid black;border-top:2px dashed red;border-right:3px dotted blue;border-bottom:4px double green;border-left:0;" +
      "border-top-width:1px;border-top-style:solid;border-top-color:red;" +
      "border-right-width:2px;border-right-style:dashed;border-right-color:blue;" +
      "border-bottom-width:3px;border-bottom-style:dotted;border-bottom-color:green;" +
      "border-left-width:4px;border-left-style:double;border-left-color:black;" +
      "border-collapse:collapse;border-spacing:0 2px;border-radius:5px;background-color:#fff;background:transparent!important";

    expect(normalize(`<style>.safe{${declarations}}</style><div class="safe"></div>`)).toBe(
      `<style>[data-rdx-content-root] .safe{${declarations}}</style><div data-rdx-content-root=""><div class="safe"></div></div>`
    );
  });

  it("accepts safe positions, display modes, lengths, and color syntaxes only", () => {
    const input =
      "<style>.safe{" +
      "position:static;position:relative;position:absolute;position:fixed;position:sticky;" +
      "display:block;display:inline;display:inline-block;display:flex;display:inline-flex;display:table;display:table-row;display:table-cell;display:list-item;display:none;display:grid;" +
      "width:auto;width:min(100%,500px);min-width:min-content;max-width:max-content;max-width:max(10px,20vw);" +
      "height:fit-content;height:fit-content(100px);min-height:10em;max-height:calc(100vh - 10px);" +
      "color:red;color:transparent;color:currentColor;color:#abc;color:rgb(1,2,3);color:rgba(1,2,3,.5);color:hsl(120,100%,50%);color:hsla(120,100%,50%,.5)" +
      "}</style><p class=\"safe\">x</p>";
    const expected =
      "position:static;position:relative;" +
      "display:block;display:inline;display:inline-block;display:flex;display:inline-flex;display:table;display:table-row;display:table-cell;display:list-item;display:none;" +
      "width:auto;width:min(100%,500px);min-width:min-content;max-width:max-content;max-width:max(10px,20vw);" +
      "height:fit-content;height:fit-content(100px);min-height:10em;max-height:calc(100vh - 10px);" +
      "color:red;color:transparent;color:currentColor;color:#abc;color:rgb(1,2,3);color:rgba(1,2,3,.5);color:hsl(120,100%,50%);color:hsla(120,100%,50%,.5)";

    expect(normalize(input)).toBe(
      `<style>[data-rdx-content-root] .safe{${expected}}</style><div data-rdx-content-root=""><p class="safe">x</p></div>`
    );
  });

  it("allows only color backgrounds and rejects every resource or image form", () => {
    const input =
      "<style>.safe{" +
      "background:none;background:transparent;background:currentColor;background:red;background:#fff;background:rgb(1,2,3);background:hsl(120,100%,50%);" +
      "background:url(https://example.com/a.png);background:linear-gradient(red,blue);background:color(display-p3 1 0 0);background:lab(50% 0 0);" +
      "list-style:url(https://example.com/a.png);transition:javascript 1s;color:var(--theme);width:expression(alert(1));" +
      "color:oklch(50% .2 120);width:clamp(1px,2vw,10px);--theme:red;behavior:url(x);-moz-binding:url(x);" +
      "top:0;z-index:10;transform:scale(2);opacity:.5" +
      "}</style><p class=\"safe\">x</p>";
    const expected =
      "background:none;background:transparent;background:currentColor;background:red;background:#fff;background:rgb(1,2,3);background:hsl(120,100%,50%)";

    expect(normalize(input)).toBe(
      `<style>[data-rdx-content-root] .safe{${expected}}</style><div data-rdx-content-root=""><p class="safe">x</p></div>`
    );
  });

  it("rejects invalid grammars and literal or escaped script-bearing CSS tokens", () => {
    const input =
      "<style>.safe{" +
      "color:1px;width:red;border:nonsense;background:u\\72l(javascript:alert(1));" +
      "background:url(\\6a avascript:alert(1));transition:vbscript 1s;" +
      "transition:j\\61vascript 1s;transition:v\\62script 1s;font-size:12px" +
      "}</style><p class=\"safe\">x</p>";

    expect(normalize(input)).toBe(
      '<style>[data-rdx-content-root] .safe{font-size:12px}</style><div data-rdx-content-root=""><p class="safe">x</p></div>'
    );
  });

  it("rejects literal or escaped decoded binding identifiers in stylesheet and inline transitions", () => {
    const input =
      "<style>.safe{" +
      "transition:color 200ms ease;transition:behavior 1s;transition:b\\65 havior 1s;" +
      "transition:-moz-binding 1s;transition:-\\6d oz-binding 1s" +
      "}</style>" +
      '<p class="safe" style="transition:opacity 100ms;transition:behavior 1s;transition:b\\65 havior 1s;' +
      'transition:-moz-binding 1s;transition:-\\6d oz-binding 1s">x</p>';

    expect(normalize(input)).toBe(
      '<style>[data-rdx-content-root] .safe{transition:color 200ms ease}</style>' +
      '<div data-rdx-content-root=""><p class="safe" style="transition:opacity 100ms">x</p></div>'
    );
  });

  it("applies the identical declaration policy to inline styles and removes empty style attributes", () => {
    const input =
      '<p class="x" style="position:fixed;color:red;width:25% !important;background:url(javascript:evil);--x:blue">safe</p>' +
      '<span style="behavior:url(x);color:var(--x)">empty</span>';

    expect(normalize(input)).toBe(
      '<div data-rdx-content-root=""><p class="x" style="color:red;width:25%!important">safe</p><span>empty</span></div>'
    );
  });

  it("preserves important flags and declaration and rule order", () => {
    const input =
      "<style>.x{color:red!important;color:blue;margin:0}.y{font-weight:bold}.x{padding:1px}</style><p class=\"x\">x</p>";

    expect(normalize(input)).toBe(
      '<style>[data-rdx-content-root] .x{color:red!important;color:blue;margin:0}[data-rdx-content-root] .y{font-weight:bold}[data-rdx-content-root] .x{padding:1px}</style><div data-rdx-content-root=""><p class="x">x</p></div>'
    );
  });

  it("keeps safe sibling declarations and rules when unsafe siblings are dropped", () => {
    const input =
      "<style>.mixed{position:fixed;color:green;width:nonsense;padding:2px}.empty{background:url(x)}.safe{font-weight:bold}</style><p class=\"mixed\">x</p>";

    expect(normalize(input)).toBe(
      '<style>[data-rdx-content-root] .mixed{color:green;padding:2px}[data-rdx-content-root] .safe{font-weight:bold}</style><div data-rdx-content-root=""><p class="mixed">x</p></div>'
    );
  });

  it("keeps only an exact print media rule and scopes its nested selectors", () => {
    const input =
      "<style>" +
      "@media print{body > table,.x{width:100%!important}}" +
      "@media screen{.screen{color:red}}@media print and (color){.print-color{color:red}}" +
      "@import url(https://example.com/a.css);@font-face{font-family:x;src:url(x)}" +
      "@keyframes x{from{color:red}to{color:blue}}@supports(display:block){.x{display:block}}" +
      "@namespace svg url(x);@page{margin:1cm}@layer base{.x{color:red}}@unknown x{.x{color:red}}" +
      ".safe{color:blue}" +
      "</style><table></table><p class=\"x safe\">x</p>";

    expect(normalize(input)).toBe(
      '<style>@media print{[data-rdx-content-root]>table,[data-rdx-content-root] .x{width:100%!important}}[data-rdx-content-root] .safe{color:blue}</style><div data-rdx-content-root=""><table></table><p class="x safe">x</p></div>'
    );
  });

  it("drops all stylesheet CSS when split style blocks exceed the aggregate limit", () => {
    const input =
      `<style>.a{color:red}${" ".repeat(50_000)}</style>` +
      `<style>.b{color:blue}${" ".repeat(50_000)}</style>` +
      '<p class="a b" style="color:green">x</p>';

    expect(normalize(input)).toBe(
      '<div data-rdx-content-root=""><p class="a b" style="color:green">x</p></div>'
    );
  });
});

describe("Sanitizer canonical and BKU regression contract", () => {
  const normalize = (value: string): string => new Sanitizer().normalizeHtml(value);
  const bkuTemplate = readFileSync(
    resolve(process.cwd(), "test/fixtures/bku-template.html"),
    "utf8"
  );

  it("is byte-idempotent for canonical HTML, inline CSS, stylesheet CSS, and attributes", () => {
    const input =
      '<style>body > .x,.x:hover{color:red!important;margin:0}@media print{table{width:100%}}</style>' +
      '<div data-rdx-content-root="old" class="attacker"><p title="tip" class="x" style="width:25%;position:fixed">x</p></div>';
    const once = normalize(input);

    expect(normalize(once)).toBe(once);
    expect(once).toBe(
      '<style>[data-rdx-content-root]>.x,[data-rdx-content-root] .x:hover{color:red!important;margin:0}@media print{[data-rdx-content-root] table{width:100%}}</style><div data-rdx-content-root=""><p class="x" style="width:25%" title="tip">x</p></div>'
    );
  });

  it("encodes every generated less-than sign before crossing the style raw-text boundary", () => {
    const input =
      '<style>.x{font-family:"\\3c /style\\3e \\3c img src=x onerror=alert(1)\\3e \\3c !-- \\3c p id=escape\\3e "}</style>' +
      '<p class="x">safe</p>';
    const once = normalize(input);
    const reparsed = new DOMParser().parseFromString(once, "text/html");
    const stylesheet = reparsed.querySelector("style")?.textContent ?? "";

    expect(reparsed.querySelectorAll("style")).toHaveLength(1);
    expect(reparsed.body.children).toHaveLength(1);
    expect(reparsed.body.firstElementChild?.hasAttribute("data-rdx-content-root")).toBe(true);
    expect(reparsed.querySelectorAll("[data-rdx-content-root]")).toHaveLength(1);
    expect(reparsed.querySelector("img")).toBeNull();
    expect(reparsed.querySelector("#escape")).toBeNull();
    expect(stylesheet).not.toContain("<");
    expect(stylesheet.match(/\\3c /g)).toHaveLength(4);
    expect(normalize(once)).toBe(once);
  });

  it("keeps all emitted selector branches rooted away from extension chrome", () => {
    const normalized = normalize(
      "<style>.rdx-toolbar,.rdx-status,.rdx-message,.rdx-context-menu,body .content{color:red}</style><p class=\"content\">x</p>"
    );
    const parsed = new DOMParser().parseFromString(
      '<div class="rdx-toolbar"></div><div class="rdx-status"></div><div class="rdx-message"></div><div class="rdx-context-menu"></div>' +
        normalized,
      "text/html"
    );
    const shellNodes = Array.from(parsed.body.querySelectorAll("[class^=rdx-]"));
    const stylesheet = parsed.querySelector("style")?.textContent ?? "";
    const stylesheetAst = cssTree.parse(stylesheet, { context: "stylesheet" });
    const selectors: string[] = [];
    cssTree.walk(stylesheetAst, {
      visit: "Selector",
      enter: selector => selectors.push(cssTree.generate(selector))
    });

    expect(selectors).toEqual([
      "[data-rdx-content-root] .rdx-toolbar",
      "[data-rdx-content-root] .rdx-status",
      "[data-rdx-content-root] .rdx-message",
      "[data-rdx-content-root] .rdx-context-menu",
      "[data-rdx-content-root] .content"
    ]);
    expect(selectors.every(selector => selector.startsWith("[data-rdx-content-root]"))).toBe(true);
    expect(shellNodes.every(node => selectors.every(selector => !node.matches(selector)))).toBe(true);
  });

  it("preserves the BKU six-table structure, headings, visual rules, print rule, and safe anchor", () => {
    const normalized = normalize(bkuTemplate);
    const parsed = new DOMParser().parseFromString(normalized, "text/html");
    const root = parsed.body.querySelector("[data-rdx-content-root]");
    const stylesheet = parsed.querySelector("style")?.textContent ?? "";
    const stylesheetAst = cssTree.parse(stylesheet, { context: "stylesheet" });
    const selectors: string[] = [];
    cssTree.walk(stylesheetAst, {
      visit: "Selector",
      enter: selector => selectors.push(cssTree.generate(selector))
    });

    expect(parsed.body.querySelectorAll("table")).toHaveLength(6);
    expect(root?.attributes).toHaveLength(1);
    expect(root?.querySelectorAll(".heading").length).toBeGreaterThan(0);
    expect(root?.querySelector('a[href^="https://"]')).not.toBeNull();
    expect(stylesheet).toContain(
      '[data-rdx-content-root] .main_pdf_cont table.pdf_table{border:1px solid black}'
    );
    expect(stylesheet).toContain('font-family:"Times New Roman",Times,serif');
    expect(stylesheet).toContain("font-size:16px");
    expect(stylesheet).toContain("font-weight:bold");
    expect(stylesheet).toContain("color:#253342");
    expect(stylesheet).toContain(
      "@media print{[data-rdx-content-root] .main_pdf_cont,[data-rdx-content-root] table{width:100%!important}}"
    );
    expect(selectors.length).toBeGreaterThan(60);
    expect(selectors.every(selector => selector.startsWith("[data-rdx-content-root]"))).toBe(true);
    expect(normalize(normalized)).toBe(normalized);
  });
});

describe("Sanitizer unexpected failure isolation", () => {
  it("discards every CSS source when an inline policy call throws", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const policy: CanonicalCssPolicy = {
      normalizeDeclarationList: value => {
        if (value.includes("width")) {
          throw new Error("SECRET_INLINE_POLICY_ERROR");
        }
        return value;
      },
      normalizeStylesheet: () => "[data-rdx-content-root] .x{color:green}"
    };
    const normalized = canonicalizeHtml(
      '<style>.x{color:green}</style><p class="x" style="color:red">one</p>' +
        '<span style="width:2px">two</span><b style="color:blue">three</b>',
      policy
    );

    expect(normalized).toBe(
      '<div data-rdx-content-root=""><p class="x">one</p><span>two</span><b>three</b></div>'
    );
    expect(warn.mock.calls).toEqual([["RDX_SANITIZER_CSS_POLICY_FAILURE", 4]]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("SECRET");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("Error");
  });

  it("discards every CSS source when stylesheet policy generation throws", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const policy: CanonicalCssPolicy = {
      normalizeDeclarationList: value => value,
      normalizeStylesheet: () => {
        throw new Error("SECRET_STYLESHEET_POLICY_ERROR");
      }
    };
    const normalized = canonicalizeHtml(
      '<style>.x{color:green}</style><p style="color:red">one</p><span style="width:2px">two</span>',
      policy
    );

    expect(normalized).toBe(
      '<div data-rdx-content-root=""><p>one</p><span>two</span></div>'
    );
    expect(warn.mock.calls).toEqual([["RDX_SANITIZER_CSS_POLICY_FAILURE", 3]]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("SECRET");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("Error");
  });

  it("returns the empty wrapper and logs only a controlled code when HTML parsing throws", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(DOMParser.prototype, "parseFromString").mockImplementation(() => {
      throw new Error("SECRET_HTML_SOURCE_OR_ERROR");
    });

    expect(new Sanitizer().normalizeHtml("<p>SECRET_HTML_CONTENT</p>")).toBe(
      '<div data-rdx-content-root=""></div>'
    );
    expect(warn.mock.calls).toEqual([["RDX_SANITIZER_HTML_FAILURE"]]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("SECRET");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("Error");
  });
});
