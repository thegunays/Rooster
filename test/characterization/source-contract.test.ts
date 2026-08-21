import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) => readFileSync(resolve(path), "utf8");
const telemetrySource = readSource("src/telemetry/TelemetryClient.ts");
const controlSource = readSource("src/control/RoosterDescriptionControl.ts");
const bootstrapSource = readSource("src/control/bootstrap.ts");

describe("legacy private literal contracts", () => {
  it("keeps the exact seven telemetry event names", () => {
    const eventNameType = telemetrySource.match(
      /export type TelemetryEventName =([\s\S]*?);\n\nexport type FeatureName/
    )?.[1];

    expect([...eventNameType!.matchAll(/\| "([^"]+)"/g)].map(match => match[1])).toEqual([
      "control_loaded",
      "autosync_success",
      "autosync_failure",
      "readonly_rendered",
      "feature_used_table",
      "feature_used_markdown",
      "feature_used_codeblock"
    ]);
  });

  it("keeps private status and failure templates that are not directly mounted here", () => {
    expect(controlSource).toContain("`Editing ${this.config.fieldName} on ${this.activeWit}`");
    expect(controlSource).toContain(
      'this.setStatusSafely(createdHost, "Pending autosync...")'
    );
    expect(controlSource).toContain('this.setStatusSafely(activeHost, "Autosynced")');
    expect(controlSource).toContain("`Synced (${new Date().toLocaleTimeString()})`");
    expect(controlSource).toContain(
      'this.setStatusSafely(host, "Reloaded from work item form")'
    );
    expect(controlSource).toContain("`Autosync failed: ${message}`");
    expect(controlSource).toContain('this.renderMessage("Work item unloaded.", generation)');
    expect(controlSource).toContain(
      '`Rooster editor is not enabled for work item type "${this.activeWit || "Unknown"}".`'
    );
    expect(bootstrapSource).toContain(
      'const INITIALIZATION_FAILURE_PREFIX = "Failed to initialize Rooster Description control: ";'
    );
  });
});
