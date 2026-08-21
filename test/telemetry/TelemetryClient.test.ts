import { describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  getHost: vi.fn(),
  getExtensionContext: vi.fn(),
  getConfiguration: vi.fn(),
  getService: vi.fn()
}));

vi.mock("azure-devops-extension-sdk", () => sdk);

import {
  TelemetryClient,
  type TelemetryClientOptions
} from "../../src/telemetry/TelemetryClient";

function createClient(messages: unknown[][]): TelemetryClient {
  const options = {
    extensionVersion: "1.2.3",
    hostType: "Services",
    now: () => new Date("2026-08-18T12:34:56.000Z"),
    info: (...values: unknown[]) => messages.push(values)
  } satisfies TelemetryClientOptions;

  return new TelemetryClient(options);
}

describe("TelemetryClient", () => {
  it("does not access Azure SDK metadata while importing or constructing", () => {
    createClient([]);

    expect(sdk.getHost).not.toHaveBeenCalled();
    expect(sdk.getExtensionContext).not.toHaveBeenCalled();
    expect(sdk.getConfiguration).not.toHaveBeenCalled();
    expect(sdk.getService).not.toHaveBeenCalled();
  });

  it("emits a fixed primitive-only telemetry envelope", () => {
    const messages: unknown[][] = [];
    const client = createClient(messages);

    client.track(
      "autosync_failure",
      {
        safe: true,
        count: 2,
        objectValue: { secret: "x" },
        error: new Error("stack/content"),
        html: "<p>secret</p>",
        url: "https://secret.example"
      } as unknown as Record<string, unknown>
    );

    expect(messages).toEqual([
      [
        "[rdx-telemetry]",
        JSON.stringify({
          eventName: "autosync_failure",
          timestamp: "2026-08-18T12:34:56.000Z",
          extensionVersion: "1.2.3",
          hostType: "Services",
          properties: { safe: true, count: 2 }
        })
      ]
    ]);
  });

  it("maps features to the existing telemetry event names", () => {
    const messages: unknown[][] = [];
    const client = createClient(messages);

    client.trackFeature("markdown", { fieldName: "Custom.RoosterContent" });

    expect(JSON.parse(messages[0]![1] as string)).toMatchObject({
      eventName: "feature_used_markdown",
      properties: { fieldName: "Custom.RoosterContent" }
    });
  });

  it("drops content-bearing keys while preserving approved primitive metadata", () => {
    const messages: unknown[][] = [];
    const client = createClient(messages);

    client.track("control_loaded", {
      wit: "SRS",
      fieldName: "Custom.RoosterContent",
      isReadOnly: false,
      isEnabled: true,
      errorCode: "TimeoutError",
      operation: "autosync",
      cssRule: "display:none",
      bodyText: "private",
      selectedValue: "private",
      Stack: "private",
      Error: "private"
    });

    expect(JSON.parse(messages[0]![1] as string).properties).toEqual({
      wit: "SRS",
      fieldName: "Custom.RoosterContent",
      isReadOnly: false,
      isEnabled: true,
      errorCode: "TimeoutError",
      operation: "autosync"
    });
  });
});
