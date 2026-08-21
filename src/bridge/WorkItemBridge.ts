import * as SDK from "azure-devops-extension-sdk";
import {
  WorkItemTrackingServiceIds
} from "azure-devops-extension-api/WorkItemTracking";
import type {
  IWorkItemFieldChangedArgs,
  IWorkItemFormService
} from "azure-devops-extension-api/WorkItemTracking";

export type WorkItemFormServiceProvider = () => Promise<IWorkItemFormService>;

const getWorkItemFormService: WorkItemFormServiceProvider = () =>
  SDK.getService<IWorkItemFormService>(WorkItemTrackingServiceIds.WorkItemFormService);

function hasOwnChangedField(args: IWorkItemFieldChangedArgs, fieldName: string): boolean {
  return Object.prototype.hasOwnProperty.call(args.changedFields || {}, fieldName);
}

export class WorkItemBridge {
  private constructor(private readonly formService: IWorkItemFormService) {}

  static async create(
    provider: WorkItemFormServiceProvider = getWorkItemFormService
  ): Promise<WorkItemBridge> {
    const formService = await provider();

    return new WorkItemBridge(formService);
  }

  async getFieldValue(fieldName: string): Promise<string> {
    const value = await this.formService.getFieldValue(fieldName);
    return value == null ? "" : String(value);
  }

  async setFieldValue(fieldName: string, value: string): Promise<void> {
    await this.formService.setFieldValue(fieldName, value);
  }

  async getWorkItemType(): Promise<string> {
    return this.getFieldValue("System.WorkItemType");
  }

  hasFieldChanged(args: IWorkItemFieldChangedArgs, fieldName: string): boolean {
    return hasOwnChangedField(args, fieldName);
  }

  static hasFieldChanged(args: IWorkItemFieldChangedArgs, fieldName: string): boolean {
    return hasOwnChangedField(args, fieldName);
  }
}
