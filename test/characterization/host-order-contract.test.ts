import { afterEach, describe, expect, it, vi } from "vitest";

const sdkModule = "azure-devops-extension-sdk";
const workItemModule = "azure-devops-extension-api/WorkItemTracking";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.doUnmock(sdkModule);
  vi.doUnmock(workItemModule);
  vi.resetModules();
});

describe("SDK bootstrap contract", () => {
  it("calls SDK methods in the approved configuration-first metadata order", async () => {
    const calls: string[] = [];
    vi.doMock(workItemModule, () => ({
      WorkItemTrackingServiceIds: { WorkItemFormService: "work-item-form-service" }
    }));
    vi.doMock(sdkModule, () => ({
      init: async () => calls.push("init"),
      ready: async () => calls.push("ready"),
      getHost: () => {
        calls.push("getHost");
        return { isHosted: true };
      },
      getExtensionContext: () => {
        calls.push("getExtensionContext");
        return { version: "0.1.21" };
      },
      getConfiguration: () => {
        calls.push("getConfiguration");
        return { witInputs: { FieldName: "Custom.RoosterContent" } };
      },
      getService: async () => {
        calls.push("getService");
        return {};
      },
      getContributionId: () => {
        calls.push("getContributionId");
        return "rooster-description-control";
      },
      register: () => calls.push("register"),
      notifyLoadSucceeded: () => calls.push("notifyLoadSucceeded"),
      notifyLoadFailed: () => calls.push("notifyLoadFailed")
    }));
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    document.body.innerHTML = '<div id="app"></div>';

    await import("../../src/control/index");
    await vi.waitFor(() => {
      expect(calls).toEqual([
        "init",
        "ready",
        "getConfiguration",
        "getHost",
        "getExtensionContext",
        "getService",
        "getContributionId",
        "register",
        "notifyLoadSucceeded"
      ]);
    });
  });

  it("uses the legacy initialization failure prefix and failure notification", async () => {
    const calls: string[] = [];
    vi.doMock(workItemModule, () => ({
      WorkItemTrackingServiceIds: { WorkItemFormService: "work-item-form-service" }
    }));
    vi.doMock(sdkModule, () => ({
      init: async () => calls.push("init"),
      ready: async () => calls.push("ready"),
      getHost: () => {
        calls.push("getHost");
        return { isHosted: false };
      },
      getExtensionContext: () => {
        calls.push("getExtensionContext");
        return { version: "0.1.21" };
      },
      getConfiguration: () => {
        calls.push("getConfiguration");
        return { witInputs: { FieldName: "Custom.RoosterContent" } };
      },
      getService: async () => {
        calls.push("getService");
        throw new Error("service unavailable");
      },
      getContributionId: () => {
        calls.push("getContributionId");
        return "rooster-description-control";
      },
      register: () => calls.push("register"),
      notifyLoadSucceeded: () => calls.push("notifyLoadSucceeded"),
      notifyLoadFailed: (message: string) => calls.push(`notifyLoadFailed:${message}`)
    }));
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    document.body.innerHTML = '<div id="app"></div>';

    await import("../../src/control/index");
    await vi.waitFor(() => {
      expect(document.getElementById("app")?.textContent).toBe(
        "Failed to initialize Rooster Description control: service unavailable"
      );
      expect(calls).toEqual([
        "init",
        "ready",
        "getConfiguration",
        "getHost",
        "getExtensionContext",
        "getService",
        "notifyLoadFailed:service unavailable"
      ]);
    });
  });
});
