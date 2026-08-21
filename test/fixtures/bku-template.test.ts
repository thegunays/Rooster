import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const fixturePath = resolve("test/fixtures/bku-template.html");
const provenancePath = resolve("test/fixtures/bku-template.provenance.md");

describe("BKU template fixture", () => {
  it("preserves the recovered DOCX HTML text payload", () => {
    expect(existsSync(fixturePath)).toBe(true);
    const html = readFileSync(fixturePath, "utf8");
    expect(Buffer.byteLength(html)).toBe(10_423);
    expect(createHash("sha256").update(html).digest("hex")).toBe(
      "0005e3eff97cc3aa39bbb2d90aa5b6f76b4435eb4b679d5ae3e1182b61c24b2a"
    );
    expect(html.match(/<table\b/gi)).toHaveLength(6);
    expect(html.match(/<style\b/gi)).toHaveLength(1);
    expect(html).toContain('class="green big_heading"');
    expect(html).toContain("table.pdf_table");
    expect(html).toContain("border:1px solid black");
    expect(html).toContain("@media print");
    expect(html).toContain("transition:all 200ms ease-in-out");
  });

  it("records the raw DOCX payload separately from its required final-LF fixture form", () => {
    const html = readFileSync(fixturePath, "utf8");
    const rawPayload = html.slice(0, -1);
    const provenance = readFileSync(provenancePath, "utf8");

    expect(html.endsWith("\n")).toBe(true);
    expect(Buffer.byteLength(rawPayload)).toBe(10_422);
    expect(createHash("sha256").update(rawPayload).digest("hex")).toBe(
      "fee427bbf27a15e4c0d846ec0249015924d76551880842326291fa44b137e490"
    );
    expect(html).toBe(`${rawPayload}\n`);
    expect(provenance).toContain("Raw extraction byte length: `10,422` bytes");
    expect(provenance).toContain(
      "Raw extraction SHA-256: `fee427bbf27a15e4c0d846ec0249015924d76551880842326291fa44b137e490`"
    );
    expect(provenance).toContain("Transformation: append exactly one final LF (`\\n`).");
  });
});
