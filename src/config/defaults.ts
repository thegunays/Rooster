export interface ControlConfig {
  readonly fieldName: string;
  readonly fieldNameWasExplicit: boolean;
  readonly enabledWits: readonly string[];
  readonly debounceMs: number;
  readonly enableMarkdownAutoformat: boolean;
  readonly enableCodeBlock: boolean;
}

const DEFAULTS = {
  fieldName: "System.Description",
  enabledWits: ["SRS", "HLD"],
  debounceMs: 500,
  enableMarkdownAutoformat: true,
  enableCodeBlock: true
} as const;

function getOwnDataProperty(value: unknown, propertyName: string): unknown {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  ) {
    return undefined;
  }

  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, propertyName);
    return descriptor && Object.prototype.hasOwnProperty.call(descriptor, "value")
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function getOwnString(value: unknown, propertyName: string): string | undefined {
  const candidate = getOwnDataProperty(value, propertyName);
  return typeof candidate === "string" ? candidate : undefined;
}

function normalizeWitName(value: string): string {
  return value.trim().toLowerCase();
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parseDebounce(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
}

function parseWits(value: string | undefined, fallback: readonly string[]): string[] {
  if (!value) {
    return fallback.map(normalizeWitName);
  }

  const parsed = value
    .split(",")
    .map(part => normalizeWitName(part))
    .filter(Boolean);

  return parsed.length > 0 ? parsed : fallback.map(normalizeWitName);
}

export function getControlConfig(rawConfig: unknown): ControlConfig {
  const inputs = getOwnDataProperty(rawConfig, "witInputs");
  const explicitFieldName = getOwnString(inputs, "FieldName")?.trim() ?? "";
  const fieldNameWasExplicit = explicitFieldName.length > 0;
  const enabledWits = Object.freeze(
    parseWits(getOwnString(inputs, "EnabledWits"), DEFAULTS.enabledWits)
  );
  const normalizedConfig = {
    fieldName: fieldNameWasExplicit ? explicitFieldName : DEFAULTS.fieldName,
    fieldNameWasExplicit,
    enabledWits,
    debounceMs: parseDebounce(getOwnString(inputs, "DebounceMs"), DEFAULTS.debounceMs),
    enableMarkdownAutoformat: parseBool(
      getOwnString(inputs, "EnableMarkdownAutoformat"),
      DEFAULTS.enableMarkdownAutoformat
    ),
    enableCodeBlock: parseBool(
      getOwnString(inputs, "EnableCodeBlock"),
      DEFAULTS.enableCodeBlock
    )
  };

  return Object.freeze(normalizedConfig);
}

export function isEnabledWit(config: ControlConfig, witName: string): boolean {
  return config.enabledWits.includes(normalizeWitName(witName));
}
