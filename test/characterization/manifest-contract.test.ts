import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(readFileSync(resolve("vss-extension.json"), "utf8")) as {
  publisher: string;
  id: string;
  version: string;
  public: boolean;
  categories: string[];
  targets: Array<{ id: string }>;
  scopes: string[];
  files: Array<{ path: string; addressable: boolean }>;
  contributions: Array<{
    id: string;
    type: string;
    targets: string[];
    properties: {
      name: string;
      uri: string;
      height: number;
      inputs: Array<{
        id: string;
        description: string;
        type?: string;
        properties?: { workItemFieldTypes: string[] };
        validation: { dataType: string; isRequired: boolean };
      }>;
    };
    inputs?: unknown;
  }>;
};

describe("extension manifest contract", () => {
  it("preserves extension identity, availability, and package files", () => {
    expect(manifest).toMatchObject({
      publisher: "ygdb121",
      id: "roosterjs-description-editor",
      version: "0.1.25",
      public: false,
      categories: ["Plan and track"],
      targets: [{ id: "Microsoft.VisualStudio.Services" }],
      scopes: ["vso.work_write"]
    });
    expect(manifest.files).toEqual([
      { path: "static", addressable: true },
      { path: "dist", addressable: true }
    ]);
  });

  it("preserves contribution placement and all input definitions", () => {
    expect(manifest.contributions).toHaveLength(1);
    const [contribution] = manifest.contributions;
    expect(contribution).toMatchObject({
      id: "rooster-description-control",
      type: "ms.vss-work-web.work-item-form-control",
      targets: ["ms.vss-work-web.work-item-form"],
      properties: { name: "Description (Rooster)", uri: "static/control.html", height: 570 }
    });
    expect(Object.prototype.hasOwnProperty.call(contribution, "inputs")).toBe(false);
    expect(contribution.properties.inputs).toEqual([
      {
        id: "FieldName",
        description: "Target field reference name.",
        type: "WorkItemField",
        properties: { workItemFieldTypes: ["HTML"] },
        validation: { dataType: "String", isRequired: true }
      },
      {
        id: "EnabledWits",
        description: "Comma-separated list of enabled work item types.",
        validation: { dataType: "String", isRequired: true }
      },
      {
        id: "DebounceMs",
        description: "Autosync debounce value in milliseconds.",
        validation: { dataType: "String", isRequired: false }
      },
      {
        id: "EnableMarkdownAutoformat",
        description: "Enable markdown auto-format shortcuts.",
        validation: { dataType: "String", isRequired: false }
      },
      {
        id: "EnableCodeBlock",
        description: "Enable code block toolbar action.",
        validation: { dataType: "String", isRequired: false }
      }
    ]);
  });
});
