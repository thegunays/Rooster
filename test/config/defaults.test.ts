import { describe, expect, it, vi } from "vitest";
import { getControlConfig, isEnabledWit } from "../../src/config/defaults";

describe("defaults config parser", () => {
  it("uses defaults when no inputs are provided", () => {
    const config = getControlConfig({});

    expect(config.fieldName).toBe("System.Description");
    expect(config.fieldNameWasExplicit).toBe(false);
    expect(config.enabledWits).toEqual(["srs", "hld"]);
    expect(config.debounceMs).toBe(500);
    expect(config.enableMarkdownAutoformat).toBe(true);
    expect(config.enableCodeBlock).toBe(true);
  });

  it("parses and normalizes contribution inputs", () => {
    const config = getControlConfig({
      witInputs: {
        FieldName: "System.Description",
        EnabledWits: " SRS, hld , Feature ",
        DebounceMs: "750",
        EnableMarkdownAutoformat: "false",
        EnableCodeBlock: "0"
      }
    });

    expect(config.fieldName).toBe("System.Description");
    expect(config.enabledWits).toEqual(["srs", "hld", "feature"]);
    expect(config.debounceMs).toBe(750);
    expect(config.enableMarkdownAutoformat).toBe(false);
    expect(config.enableCodeBlock).toBe(false);
  });

  it("tracks whether a field name was explicitly configured", () => {
    expect(getControlConfig({ witInputs: { FieldName: "   " } }).fieldNameWasExplicit).toBe(
      false
    );
    expect(
      getControlConfig({ witInputs: { FieldName: " Custom.RoosterContent " } })
    ).toMatchObject({
      fieldName: "Custom.RoosterContent",
      fieldNameWasExplicit: true
    });
  });

  it("rejects inherited configuration containers and inherited FieldName capabilities", () => {
    const inheritedContainer = Object.create({
      witInputs: { FieldName: "System.Description" }
    });
    const inheritedField = Object.create({ FieldName: "System.Description" });

    expect(getControlConfig(inheritedContainer)).toMatchObject({
      fieldName: "System.Description",
      fieldNameWasExplicit: false
    });
    expect(getControlConfig({ witInputs: inheritedField })).toMatchObject({
      fieldName: "System.Description",
      fieldNameWasExplicit: false
    });
  });

  it("rejects accessor capabilities without invoking their getters", () => {
    const fieldGetter = vi.fn(() => "System.Description");
    const inputsGetter = vi.fn(() => ({ FieldName: "System.Description" }));
    const accessorField = Object.defineProperty({}, "FieldName", { get: fieldGetter });
    const accessorInputs = Object.defineProperty({}, "witInputs", { get: inputsGetter });

    expect(getControlConfig({ witInputs: accessorField }).fieldNameWasExplicit).toBe(false);
    expect(getControlConfig(accessorInputs).fieldNameWasExplicit).toBe(false);
    expect(fieldGetter).not.toHaveBeenCalled();
    expect(inputsGetter).not.toHaveBeenCalled();
  });

  it.each([
    ["duck-typed", { trim: () => "System.Description" }],
    ["number", 42],
    ["boolean", true],
    ["symbol", Symbol("System.Description")],
    ["null", null]
  ])("rejects a %s non-string FieldName without throwing", (_label, FieldName) => {
    expect(() => getControlConfig({ witInputs: { FieldName } })).not.toThrow();
    expect(getControlConfig({ witInputs: { FieldName } })).toMatchObject({
      fieldName: "System.Description",
      fieldNameWasExplicit: false
    });
  });

  it("falls back safely for malformed configuration objects and descriptor traps", () => {
    const hostile = new Proxy(
      {},
      {
        getOwnPropertyDescriptor: () => {
          throw new Error("descriptor trap must be contained");
        },
        get: () => {
          throw new Error("property access must not occur");
        }
      }
    );

    for (const raw of [null, undefined, 17, "text", true, hostile]) {
      expect(getControlConfig(raw)).toEqual({
        fieldName: "System.Description",
        fieldNameWasExplicit: false,
        enabledWits: ["srs", "hld"],
        debounceMs: 500,
        enableMarkdownAutoformat: true,
        enableCodeBlock: true
      });
    }
  });

  it("reads every contribution input only from own primitive-string data properties", () => {
    const inherited = Object.create({
      EnabledWits: "Bug",
      DebounceMs: "5",
      EnableMarkdownAutoformat: "false",
      EnableCodeBlock: "false"
    });
    Object.defineProperty(inherited, "FieldName", {
      value: "Custom.RoosterContent",
      enumerable: true
    });
    const debounceGetter = vi.fn(() => "1");
    Object.defineProperty(inherited, "DebounceMs", { get: debounceGetter });
    Object.defineProperty(inherited, "EnabledWits", {
      value: { split: () => ["Bug"] },
      enumerable: true
    });

    expect(getControlConfig({ witInputs: inherited })).toEqual({
      fieldName: "Custom.RoosterContent",
      fieldNameWasExplicit: true,
      enabledWits: ["srs", "hld"],
      debounceMs: 500,
      enableMarkdownAutoformat: true,
      enableCodeBlock: true
    });
    expect(debounceGetter).not.toHaveBeenCalled();
  });

  it("returns immutable configuration values", () => {
    const config = getControlConfig({});
    const descriptor = Object.getOwnPropertyDescriptor(config, "fieldNameWasExplicit");

    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.enabledWits)).toBe(true);
    expect(descriptor).toMatchObject({
      value: false,
      enumerable: true,
      writable: false,
      configurable: false
    });
    expect({ ...config }.fieldNameWasExplicit).toBe(false);
    expect(Object.assign({}, config).fieldNameWasExplicit).toBe(false);
  });

  it("falls back for invalid debounce and boolean values", () => {
    const config = getControlConfig({
      witInputs: {
        DebounceMs: "-12",
        EnableMarkdownAutoformat: "maybe",
        EnableCodeBlock: "also-maybe"
      }
    });

    expect(config.debounceMs).toBe(500);
    expect(config.enableMarkdownAutoformat).toBe(true);
    expect(config.enableCodeBlock).toBe(true);
  });

  it("matches enabled wits case-insensitively", () => {
    const config = getControlConfig({
      witInputs: {
        EnabledWits: "srs,hld"
      }
    });

    expect(isEnabledWit(config, "SRS")).toBe(true);
    expect(isEnabledWit(config, "hLd")).toBe(true);
    expect(isEnabledWit(config, "Bug")).toBe(false);
  });
});
