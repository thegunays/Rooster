import { describe, expect, it, vi } from "vitest";

import type {
  IWorkItemFormService,
  WorkItemOptions
} from "azure-devops-extension-api/WorkItemTracking";

vi.mock("azure-devops-extension-sdk", () => ({ getService: vi.fn() }));
vi.mock("azure-devops-extension-api/WorkItemTracking", () => ({
  WorkItemTrackingServiceIds: { WorkItemFormService: "work-item-form-service" }
}));

import {
  WorkItemBridge,
  type WorkItemFormServiceProvider
} from "../../src/bridge/WorkItemBridge";

type FieldWrite = [fieldName: string, value: Object];

function unsupportedServiceCall(): Promise<never> {
  return Promise.reject(new Error("Unexpected form-service method call"));
}

function deserializeExternalFieldValue(serializedValue: string): Object {
  return JSON.parse(serializedValue);
}

function createFormService(serializedValue: string, writeLog: FieldWrite[]): IWorkItemFormService {
  return {
    getId: unsupportedServiceCall,
    getRevision: unsupportedServiceCall,
    getFields: unsupportedServiceCall,
    getFieldValue: async (
      _fieldReferenceName: string,
      _options?: boolean | WorkItemOptions
    ): Promise<Object> => deserializeExternalFieldValue(serializedValue),
    getIdentityFieldValue: unsupportedServiceCall,
    getFieldValues: async (
      _fieldReferenceNames: string[],
      _options?: boolean | WorkItemOptions
    ): Promise<{ [fieldName: string]: Object }> => ({}),
    setFieldValue: async (fieldName: string, value: Object): Promise<boolean> => {
      writeLog.push([fieldName, value]);
      return true;
    },
    setFieldValues: unsupportedServiceCall,
    getAllowedFieldValues: unsupportedServiceCall,
    isDirty: unsupportedServiceCall,
    isNew: unsupportedServiceCall,
    isValid: unsupportedServiceCall,
    setError: unsupportedServiceCall,
    clearError: unsupportedServiceCall,
    save: unsupportedServiceCall,
    refresh: unsupportedServiceCall,
    reset: unsupportedServiceCall,
    getInvalidFields: unsupportedServiceCall,
    getDirtyFields: unsupportedServiceCall,
    addWorkItemRelations: unsupportedServiceCall,
    removeWorkItemRelations: unsupportedServiceCall,
    getWorkItemRelations: unsupportedServiceCall,
    getWorkItemResourceUrl: unsupportedServiceCall,
    getWorkItemRelationTypes: unsupportedServiceCall,
    hasActiveWorkItem: unsupportedServiceCall,
    beginSaveWorkItem: unsupportedServiceCall
  };
}

async function createBridge(
  serializedValue: string,
  writeLog: FieldWrite[] = []
): Promise<WorkItemBridge> {
  const formService = createFormService(serializedValue, writeLog);
  const provider: WorkItemFormServiceProvider = async () => formService;

  return WorkItemBridge.create(provider);
}

describe("WorkItemBridge", () => {
  it("normalizes nullish values without losing zero or false", async () => {
    const bridge = await createBridge("null");
    const zeroBridge = await createBridge("0");
    const falseBridge = await createBridge("false");

    expect(await bridge.getFieldValue("A")).toBe("");
    expect(await zeroBridge.getFieldValue("A")).toBe("0");
    expect(await falseBridge.getFieldValue("A")).toBe("false");
  });

  it("uses exact field operations through an injected service provider", async () => {
    const writeLog: FieldWrite[] = [];
    const bridge = await createBridge('""', writeLog);

    await bridge.setFieldValue("Custom.RoosterContent", "<p>x</p>");

    expect(writeLog).toEqual([["Custom.RoosterContent", "<p>x</p>"]]);
  });

  it("checks only own changed-field entries", async () => {
    const bridge = await createBridge('""');
    const ownArgs = { id: 1, changedFields: { "Custom.RoosterContent": true } };
    const inheritedFields: Record<string, unknown> = Object.create({
      "Custom.RoosterContent": true
    });
    const inheritedArgs = { id: 1, changedFields: inheritedFields };

    expect(bridge.hasFieldChanged(ownArgs, "Custom.RoosterContent")).toBe(true);
    expect(WorkItemBridge.hasFieldChanged(ownArgs, "Custom.RoosterContent")).toBe(true);
    expect(bridge.hasFieldChanged(inheritedArgs, "Custom.RoosterContent")).toBe(false);
    expect(WorkItemBridge.hasFieldChanged(inheritedArgs, "Custom.RoosterContent")).toBe(false);
  });
});
