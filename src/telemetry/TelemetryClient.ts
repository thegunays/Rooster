type HostKind = "Services" | "Server" | "Unknown";

export type TelemetryEventName =
  | "control_loaded"
  | "autosync_success"
  | "autosync_failure"
  | "readonly_rendered"
  | "feature_used_table"
  | "feature_used_markdown"
  | "feature_used_codeblock";

export type FeatureName = "table" | "markdown" | "codeblock";

type TelemetryPrimitive = string | number | boolean;

export interface TelemetryProperties {
  readonly [key: string]: TelemetryPrimitive | undefined;
}

export interface TelemetryClientOptions {
  readonly extensionVersion: string;
  readonly hostType: HostKind;
  readonly now?: () => Date;
  readonly info?: (...values: unknown[]) => void;
}

interface TelemetryPayload {
  eventName: TelemetryEventName;
  timestamp: string;
  extensionVersion: string;
  hostType: HostKind;
  properties: TelemetryProperties;
}

const FORBIDDEN_PROPERTY_KEY = /html|css|content|body|value|url|stack|error|selection/i;
const SAFE_ERROR_CODE_KEY = "errorcode";

function isTelemetryPrimitive(value: unknown): value is TelemetryPrimitive {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function isForbiddenPropertyKey(key: string): boolean {
  return key.toLowerCase() !== SAFE_ERROR_CODE_KEY && FORBIDDEN_PROPERTY_KEY.test(key);
}

function filterProperties(properties: Readonly<Record<string, unknown>>): TelemetryProperties {
  const filtered: Record<string, TelemetryPrimitive> = {};

  for (const [key, value] of Object.entries(properties)) {
    if (!isForbiddenPropertyKey(key) && isTelemetryPrimitive(value)) {
      filtered[key] = value;
    }
  }

  return filtered;
}

export class TelemetryClient {
  private readonly now: () => Date;
  private readonly info: (...values: unknown[]) => void;

  constructor(private readonly options: TelemetryClientOptions) {
    this.now = options.now ?? (() => new Date());
    this.info = options.info ?? console.info;
  }

  track(eventName: TelemetryEventName, properties: Readonly<Record<string, unknown>> = {}): void {
    const payload: TelemetryPayload = {
      eventName,
      timestamp: this.now().toISOString(),
      extensionVersion: this.options.extensionVersion,
      hostType: this.options.hostType,
      properties: filterProperties(properties)
    };

    this.info("[rdx-telemetry]", JSON.stringify(payload));
  }

  trackFeature(
    feature: FeatureName,
    properties: Readonly<Record<string, unknown>> = {}
  ): void {
    this.track(`feature_used_${feature}`, properties);
  }
}
