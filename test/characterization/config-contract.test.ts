import { describe, expect, it } from "vitest";

import { getControlConfig, isEnabledWit } from "../../src/config/defaults";

describe("legacy configuration contract", () => {
  it("parses every contribution input together", () => {
    expect(
      getControlConfig({
        witInputs: {
          FieldName: " Custom.RoosterContent ",
          EnabledWits: " SRS, Feature ",
          DebounceMs: "750",
          EnableMarkdownAutoformat: "off",
          EnableCodeBlock: "yes"
        }
      })
    ).toEqual({
      fieldName: "Custom.RoosterContent",
      fieldNameWasExplicit: true,
      enabledWits: ["srs", "feature"],
      debounceMs: 750,
      enableMarkdownAutoformat: false,
      enableCodeBlock: true
    });
  });

  it("uses the documented defaults for missing inputs", () => {
    expect(getControlConfig(undefined)).toEqual({
      fieldName: "System.Description",
      fieldNameWasExplicit: false,
      enabledWits: ["srs", "hld"],
      debounceMs: 500,
      enableMarkdownAutoformat: true,
      enableCodeBlock: true
    });
  });

  it("trims the field name and normalizes enabled work item types", () => {
    const config = getControlConfig({
      witInputs: {
        FieldName: "  Custom.RoosterContent  ",
        EnabledWits: " SRS, hLd , Feature "
      }
    });

    expect(config.fieldName).toBe("Custom.RoosterContent");
    expect(config.enabledWits).toEqual(["srs", "hld", "feature"]);
    expect(isEnabledWit(config, " HLD ")).toBe(true);
    expect(isEnabledWit(config, "Bug")).toBe(false);
  });

  it("falls back to System.Description and default WITs for empty inputs", () => {
    expect(
      getControlConfig({
        witInputs: { FieldName: "   ", EnabledWits: " , , " }
      })
    ).toMatchObject({ fieldName: "System.Description", enabledWits: ["srs", "hld"] });
  });

  it("keeps every default when all contribution inputs are empty", () => {
    expect(
      getControlConfig({
        witInputs: {
          FieldName: "",
          EnabledWits: "",
          DebounceMs: "",
          EnableMarkdownAutoformat: "",
          EnableCodeBlock: ""
        }
      })
    ).toEqual({
      fieldName: "System.Description",
      fieldNameWasExplicit: false,
      enabledWits: ["srs", "hld"],
      debounceMs: 500,
      enableMarkdownAutoformat: true,
      enableCodeBlock: true
    });
  });

  it("parses integer debounce values and rejects invalid or negative values", () => {
    expect(getControlConfig({ witInputs: { DebounceMs: "0750ms" } }).debounceMs).toBe(750);
    expect(getControlConfig({ witInputs: { DebounceMs: "0" } }).debounceMs).toBe(0);
    expect(getControlConfig({ witInputs: { DebounceMs: "-1" } }).debounceMs).toBe(500);
    expect(getControlConfig({ witInputs: { DebounceMs: "not-a-number" } }).debounceMs).toBe(500);
  });

  it.each([
    ["true", true],
    ["1", true],
    [" YES ", true],
    ["on", true],
    ["false", false],
    ["0", false],
    [" No ", false],
    ["off", false]
  ])("parses legacy Boolean input %j as %s", (raw, expected) => {
    const config = getControlConfig({
      witInputs: { EnableMarkdownAutoformat: raw, EnableCodeBlock: raw }
    });

    expect(config.enableMarkdownAutoformat).toBe(expected);
    expect(config.enableCodeBlock).toBe(expected);
  });

  it("keeps Boolean defaults for missing, empty, and unrecognized values", () => {
    for (const raw of [undefined, "", "maybe"]) {
      const config = getControlConfig({
        witInputs: { EnableMarkdownAutoformat: raw, EnableCodeBlock: raw }
      });
      expect(config.enableMarkdownAutoformat).toBe(true);
      expect(config.enableCodeBlock).toBe(true);
    }
  });
});
