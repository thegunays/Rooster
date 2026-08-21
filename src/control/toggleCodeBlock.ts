import {
  addCode,
  areSameFormats,
  createFormatContainer,
  getOperationalBlocks,
  getSelectedSegments,
  isBlockGroupOfType,
  unwrapBlock,
  type ContentModelFormatContainer,
  type ContentModelFormatContainerFormat,
  type IEditor,
  type ReadonlyContentModelDocument,
  type ShallowMutableContentModelBlock
} from "roosterjs";
import { splitSelectedParagraphByBr } from "roosterjs-content-model-api/lib/modelApi/block/splitSelectedParagraphByBr";
import {
  wrapBlockStep1,
  wrapBlockStep2,
  type WrapBlockStep1Result
} from "roosterjs-content-model-api/lib/modelApi/common/wrapBlock";

const CODE_BLOCK_FORMAT: ContentModelFormatContainerFormat = {
  whiteSpace: "pre",
  fontFamily: "Consolas, monospace"
};

const CODE_DECORATOR = {
  format: {
    fontFamily: "Consolas, monospace"
  }
};

export function toggleCodeBlock(editor: IEditor): void {
  editor.focus();
  editor.formatContentModel(
    (model, context) => {
      context.newPendingFormat = "preserve";
      return toggleModelCodeBlock(model);
    },
    {
      apiName: "toggleCodeBlock"
    }
  );
}

function toggleModelCodeBlock(model: ReadonlyContentModelDocument): boolean {
  splitSelectedParagraphByBr(model);

  const operationalBlocks = getOperationalBlocks(
    model,
    ["FormatContainer", "ListItem"],
    ["TableCell"],
    true,
    block => (block.blockGroupType === "FormatContainer" ? block.tagName === "pre" : true)
  );

  if (operationalBlocks.length === 0) {
    return false;
  }

  if (operationalBlocks.every(({ block }) => isCodeBlockContainer(block))) {
    operationalBlocks.forEach(({ block, parent }) => {
      if (isCodeBlockContainer(block)) {
        unwrapBlock(parent, block);
      }
    });
    clearCodeDecorator(model);
    return true;
  }

  const step1Results: WrapBlockStep1Result<ContentModelFormatContainer>[] = [];
  operationalBlocks.forEach(({ block, parent }) => {
    if (isCodeBlockContainer(block)) {
      return;
    }

    wrapBlockStep1(
      step1Results,
      parent as any,
      block as any,
      () => createFormatContainer("pre", CODE_BLOCK_FORMAT),
      (_isRtl, target) => canMergeCodeContainer(target, CODE_BLOCK_FORMAT)
    );
  });

  wrapBlockStep2(step1Results, (_isRtl, target, current) =>
    canMergeCodeContainer(target, current?.format ?? CODE_BLOCK_FORMAT)
  );
  applyCodeDecorator(model);

  return true;
}

function isCodeBlockContainer(input: unknown): input is ContentModelFormatContainer {
  return (
    isBlockGroupOfType(input as ContentModelFormatContainer, "FormatContainer") &&
    (input as ContentModelFormatContainer).tagName === "pre"
  );
}

function canMergeCodeContainer(
  target: ShallowMutableContentModelBlock,
  format: ContentModelFormatContainerFormat
): target is ContentModelFormatContainer {
  return isCodeBlockContainer(target) && areSameFormats(format, target.format);
}

function applyCodeDecorator(model: ReadonlyContentModelDocument): void {
  const selectedSegments = getSelectedSegments(model, false, true);
  selectedSegments.forEach(segment => {
    addCode(segment, CODE_DECORATOR);
  });
}

function clearCodeDecorator(model: ReadonlyContentModelDocument): void {
  const selectedSegments = getSelectedSegments(model, false, true);
  selectedSegments.forEach(segment => {
    delete segment.code;
  });
}
