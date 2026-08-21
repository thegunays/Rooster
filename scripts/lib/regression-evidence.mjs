import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute, parse, relative, resolve, sep } from "node:path";
import * as cssTree from "css-tree";
import { JSDOM } from "jsdom";

const ROOT_ATTRIBUTE = "data-rdx-content-root";
const COMMON_FIELDS = [
  "extensionVersion",
  "evidenceKind",
  "scenario",
  "beforeRawPath",
  "beforeRawSha256",
  "beforeTableCount",
  "afterTableCount",
  "headingStyleMatch",
  "borderStyleMatch",
  "colorStyleMatch",
  "domStructureMatch",
  "descriptionWriteCount",
  "targetWriteCount",
  "consoleErrors",
  "beforeScreenshot",
  "afterScreenshot"
];
const CUSTOM_FIELDS = ["afterRawPath", "afterRawSha256"];
const EXPLICIT_FIELDS = [
  "afterSaveRawPath",
  "afterRefreshRawPath",
  "afterReopenRawPath",
  "afterSaveRawSha256",
  "afterRefreshRawSha256",
  "afterReopenRawSha256",
  "canonicalRootAfterSave",
  "canonicalRootAfterReopen",
  "allStyleSelectorsScoped"
];
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export const MAX_FAILURES = 64;

export function inspectEvidencePath(absolutePath, expectedType = "file") {
  const resolvedPath = resolve(absolutePath);
  const filesystemRoot = parse(resolvedPath).root;
  const components = relative(filesystemRoot, resolvedPath).split(sep).filter(Boolean);
  let current = filesystemRoot;

  for (let index = -1; index < components.length; index += 1) {
    if (index >= 0) {
      current = resolve(current, components[index]);
    }

    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      return {
        status: error && typeof error === "object" && error.code === "ENOENT"
          ? "missing"
          : "unreadable"
      };
    }
    if (stat.isSymbolicLink()) {
      return { status: "symlink" };
    }

    const isTarget = index === components.length - 1;
    if (
      (!isTarget && !stat.isDirectory()) ||
      (isTarget && expectedType === "directory" && !stat.isDirectory()) ||
      (isTarget && expectedType !== "directory" && !stat.isFile())
    ) {
      return { status: "not-regular" };
    }
  }

  return { status: "ok", path: resolvedPath };
}

function failure(code, field, message) {
  return { code, field, message };
}

function validateObject(evidence, options) {
  const failures = [];
  const add = (code, field, message) => {
    if (failures.length < MAX_FAILURES) {
      failures.push(failure(code, field, message));
    }
  };

  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    add("INVALID_EVIDENCE", "$", "Evidence must be a JSON object.");
    return failures;
  }

  const readOwnValue = field => {
    const descriptor = Object.getOwnPropertyDescriptor(evidence, field);
    return descriptor && Object.hasOwn(descriptor, "value")
      ? descriptor.value
      : undefined;
  };
  const values = Object.create(null);
  for (const field of [...COMMON_FIELDS, ...CUSTOM_FIELDS, ...EXPLICIT_FIELDS]) {
    values[field] = readOwnValue(field);
  }

  const scenario = values.scenario;
  const allowedFields = new Set([
    ...COMMON_FIELDS,
    ...(scenario === "custom-field"
      ? CUSTOM_FIELDS
      : scenario === "explicit-system-description"
        ? EXPLICIT_FIELDS
        : [...CUSTOM_FIELDS, ...EXPLICIT_FIELDS])
  ]);
  if (Object.keys(evidence).some(field => !allowedFields.has(field))) {
    add("UNKNOWN_FIELD", "$", "Evidence contains a field outside the selected schema.");
  }

  const validStrings = new Set();
  const validHashes = new Set();
  const validWriteCounts = new Set();

  if (values.extensionVersion !== "0.1.21") {
    add(
      "INVALID_EXTENSION_VERSION",
      "extensionVersion",
      "Extension version must be exactly 0.1.21."
    );
  }
  if (values.evidenceKind !== "local-dry-run" && values.evidenceKind !== "azure-host") {
    add(
      "INVALID_EVIDENCE_KIND",
      "evidenceKind",
      "Evidence kind must be local-dry-run or azure-host."
    );
  } else if (options.requireAzureHost && values.evidenceKind !== "azure-host") {
    add(
      "AZURE_HOST_REQUIRED",
      "evidenceKind",
      "This gate requires authorized Azure-host evidence."
    );
  }
  if (scenario !== "custom-field" && scenario !== "explicit-system-description") {
    add(
      "INVALID_SCENARIO",
      "scenario",
      "Scenario must be custom-field or explicit-system-description."
    );
  }

  const requireString = field => {
    if (typeof values[field] !== "string" || values[field].length === 0) {
      add("INVALID_FIELD", field, "Field must be a non-empty string.");
      return;
    }
    validStrings.add(field);
  };
  const requireHash = field => {
    if (typeof values[field] !== "string" || !SHA256_PATTERN.test(values[field])) {
      add("INVALID_SHA256", field, "Field must be a lowercase SHA-256 digest.");
      return;
    }
    validHashes.add(field);
  };
  const requireWriteCount = field => {
    if (!Number.isSafeInteger(values[field]) || values[field] < 0) {
      add("INVALID_WRITE_COUNT", field, "Write count must be a non-negative safe integer.");
      return;
    }
    validWriteCounts.add(field);
  };

  requireString("beforeRawPath");
  requireHash("beforeRawSha256");
  requireString("beforeScreenshot");
  requireString("afterScreenshot");

  for (const field of ["beforeTableCount", "afterTableCount"]) {
    if (values[field] !== 6) {
      add("INVALID_TABLE_COUNT", field, "Declared table count must be exactly six.");
    }
  }
  for (const field of [
    "headingStyleMatch",
    "borderStyleMatch",
    "colorStyleMatch",
    "domStructureMatch"
  ]) {
    if (values[field] !== true) {
      add("VISUAL_MISMATCH", field, "Declared visual or DOM comparison must be true.");
    }
  }

  requireWriteCount("descriptionWriteCount");
  requireWriteCount("targetWriteCount");
  if (validWriteCounts.has("targetWriteCount") && values.targetWriteCount < 1) {
    add("TARGET_WRITE_REQUIRED", "targetWriteCount", "At least one target write is required.");
  }

  if (!Array.isArray(values.consoleErrors) || !values.consoleErrors.every(value => typeof value === "string")) {
    add(
      "INVALID_CONSOLE_ERRORS",
      "consoleErrors",
      "Console errors must be an array of strings."
    );
  } else if (values.consoleErrors.length !== 0) {
    add("CONSOLE_ERRORS_PRESENT", "consoleErrors", "Console error evidence must be empty.");
  }

  if (scenario === "custom-field") {
    requireString("afterRawPath");
    requireHash("afterRawSha256");
    if (validWriteCounts.has("descriptionWriteCount") && values.descriptionWriteCount !== 0) {
      add(
        "DESCRIPTION_WRITE_FORBIDDEN",
        "descriptionWriteCount",
        "Custom-field evidence must contain zero Description writes."
      );
    }
  } else if (scenario === "explicit-system-description") {
    for (const field of [
      "afterSaveRawPath",
      "afterRefreshRawPath",
      "afterReopenRawPath"
    ]) {
      requireString(field);
    }
    for (const field of [
      "afterSaveRawSha256",
      "afterRefreshRawSha256",
      "afterReopenRawSha256"
    ]) {
      requireHash(field);
    }
    for (const field of [
      "canonicalRootAfterSave",
      "canonicalRootAfterReopen",
      "allStyleSelectorsScoped"
    ]) {
      if (values[field] !== true) {
        add("DECLARED_CHECK_FAILED", field, "Declared structural check must be true.");
      }
    }
    if (validWriteCounts.has("descriptionWriteCount") && values.descriptionWriteCount < 1) {
      add(
        "DESCRIPTION_WRITE_REQUIRED",
        "descriptionWriteCount",
        "Explicit Description evidence requires at least one Description write."
      );
    }
  }

  const resolvedDirectory = typeof options.evidenceDirectory === "string"
    ? resolve(options.evidenceDirectory)
    : null;
  if (!resolvedDirectory) {
    add(
      "INVALID_EVIDENCE_DIRECTORY",
      "$",
      "Evidence directory must be supplied by the verifier."
    );
    return failures;
  }

  const directoryInspection = inspectEvidencePath(resolvedDirectory, "directory");
  if (directoryInspection.status !== "ok") {
    if (directoryInspection.status === "symlink") {
      add("SYMLINK_FORBIDDEN", "$", "Evidence directory paths must not contain symlinks.");
    } else if (directoryInspection.status === "missing") {
      add("FILE_MISSING", "$", "Evidence directory is missing.");
    } else if (directoryInspection.status === "unreadable") {
      add("FILE_UNREADABLE", "$", "Evidence directory is unreadable.");
    } else {
      add("FILE_NOT_REGULAR", "$", "Evidence directory target must be a directory.");
    }
    return failures;
  }

  const resolveEvidencePath = field => {
    if (!validStrings.has(field)) {
      return null;
    }
    const relativePath = values[field];
    const segments = relativePath.split("/");
    if (
      isAbsolute(relativePath) ||
      relativePath.includes("\\") ||
      segments.some(segment => segment === "" || segment === "." || segment === "..")
    ) {
      add(
        "INVALID_PATH",
        field,
        "Path must be a normalized relative path inside the evidence directory."
      );
      return null;
    }

    const target = resolve(resolvedDirectory, ...segments);
    const relativeTarget = relative(resolvedDirectory, target);
    if (
      relativeTarget === "" ||
      relativeTarget === ".." ||
      relativeTarget.startsWith(`..${sep}`) ||
      isAbsolute(relativeTarget)
    ) {
      add("INVALID_PATH", field, "Path must remain inside the evidence directory.");
      return null;
    }

    const inspection = inspectEvidencePath(target);
    if (inspection.status === "missing") {
      add("FILE_MISSING", field, "Referenced evidence file is missing.");
      return null;
    }
    if (inspection.status === "unreadable") {
      add("FILE_UNREADABLE", field, "Referenced evidence file is unreadable.");
      return null;
    }
    if (inspection.status === "symlink") {
      add("SYMLINK_FORBIDDEN", field, "Referenced evidence paths must not contain symlinks.");
      return null;
    }
    if (inspection.status === "not-regular") {
      add("FILE_NOT_REGULAR", field, "Referenced evidence target must be a regular file.");
      return null;
    }
    return inspection.path;
  };

  const readEvidenceFile = field => {
    const path = resolveEvidencePath(field);
    if (!path) {
      return null;
    }
    try {
      return readFileSync(path);
    } catch {
      add("FILE_UNREADABLE", field, "Referenced evidence file is unreadable.");
      return null;
    }
  };
  for (const field of ["beforeScreenshot", "afterScreenshot"]) {
    readEvidenceFile(field);
  }
  const verifyHash = (buffer, hashField) => {
    if (!buffer || !validHashes.has(hashField)) {
      return;
    }
    const actual = createHash("sha256").update(buffer).digest("hex");
    if (actual !== values[hashField]) {
      add("HASH_MISMATCH", hashField, "Declared SHA-256 does not match referenced bytes.");
    }
  };
  const verifyTableCount = (buffer, pathField) => {
    if (!buffer) {
      return;
    }
    try {
      const fragment = JSDOM.fragment(buffer.toString("utf8"));
      if (fragment.querySelectorAll("table").length !== 6) {
        add(
          "RAW_TABLE_COUNT_MISMATCH",
          pathField,
          "Referenced raw capture must contain exactly six tables."
        );
      }
    } catch {
      add("HTML_CAPTURE_INVALID", pathField, "Referenced raw capture could not be parsed.");
    }
  };

  const before = readEvidenceFile("beforeRawPath");
  verifyHash(before, "beforeRawSha256");
  verifyTableCount(before, "beforeRawPath");

  if (scenario === "custom-field") {
    const after = readEvidenceFile("afterRawPath");
    verifyHash(after, "afterRawSha256");
    verifyTableCount(after, "afterRawPath");
    if (before && after && !before.equals(after)) {
      add(
        "RAW_BYTES_CHANGED",
        "afterRawPath",
        "Custom-field before and after raw captures must be byte-identical."
      );
    }
  } else if (scenario === "explicit-system-description") {
    const captures = [
      ["afterSaveRawPath", "afterSaveRawSha256"],
      ["afterRefreshRawPath", "afterRefreshRawSha256"],
      ["afterReopenRawPath", "afterReopenRawSha256"]
    ].map(([pathField, hashField]) => {
      const buffer = readEvidenceFile(pathField);
      verifyHash(buffer, hashField);
      verifyTableCount(buffer, pathField);
      return { pathField, buffer };
    });
    if (
      captures.every(capture => capture.buffer) &&
      (!captures[0].buffer.equals(captures[1].buffer) ||
        !captures[0].buffer.equals(captures[2].buffer))
    ) {
      add(
        "CANONICAL_BYTES_DRIFTED",
        "afterRefreshRawPath",
        "Saved, refreshed, and reopened captures must be byte-identical."
      );
    }
    for (const capture of captures) {
      inspectCanonicalCapture(capture.buffer, capture.pathField, add);
    }
  }

  return failures;
}

function inspectCanonicalCapture(buffer, pathField, add) {
  if (!buffer) {
    return;
  }

  let fragment;
  try {
    fragment = JSDOM.fragment(buffer.toString("utf8"));
  } catch {
    add("HTML_CAPTURE_INVALID", pathField, "Canonical capture could not be parsed.");
    return;
  }

  const marked = collectMarkedRoots(fragment);
  const directMarked = Array.from(fragment.children).filter(element =>
    element.hasAttribute(ROOT_ATTRIBUTE)
  );
  const root = directMarked[0];
  if (
    marked.length !== 1 ||
    directMarked.length !== 1 ||
    root.tagName !== "DIV" ||
    root.getAttribute(ROOT_ATTRIBUTE) !== "" ||
    root.attributes.length !== 1
  ) {
    add(
      "CANONICAL_ROOT_INVALID",
      pathField,
      "Canonical capture must contain one neutral direct top-level content root."
    );
  }

  let stylesheetInvalid = false;
  let stylesheetPolicyInvalid = false;
  let selectorUnscoped = false;
  for (const style of collectStyles(fragment)) {
    let stylesheet;
    try {
      stylesheet = cssTree.parse(style.textContent ?? "", {
        context: "stylesheet",
        onParseError: error => {
          throw error;
        }
      });
    } catch {
      stylesheetInvalid = true;
      continue;
    }

    for (const child of stylesheet.children) {
      if (
        child.type !== "Rule" &&
        (child.type !== "Atrule" || !isAllowedPrintMedia(child))
      ) {
        stylesheetPolicyInvalid = true;
      }
    }

    cssTree.walk(stylesheet, node => {
      if (node.type === "Raw") {
        stylesheetPolicyInvalid = true;
      } else if (node.type === "Atrule" && !isAllowedPrintMedia(node)) {
        stylesheetPolicyInvalid = true;
      } else if (node.type === "Rule") {
        if (node.prelude.type !== "SelectorList") {
          selectorUnscoped = true;
          return;
        }
        for (const selector of node.prelude.children) {
          const nodes = selector.children.toArray();
          const first = nodes[0];
          const firstCombinator = nodes.find(node => node.type === "Combinator");
          if (
            !isNeutralRootSelector(first) ||
            (firstCombinator && firstCombinator.name !== " " && firstCombinator.name !== ">")
          ) {
            selectorUnscoped = true;
          }
        }
      }
    });
  }
  if (stylesheetInvalid) {
    add("STYLESHEET_INVALID", pathField, "Retained stylesheet could not be parsed.");
  }
  if (stylesheetPolicyInvalid) {
    add(
      "STYLESHEET_POLICY_INVALID",
      pathField,
      "Retained stylesheet contains syntax outside the canonical CSS policy."
    );
  }
  if (selectorUnscoped) {
    add(
      "STYLE_SELECTOR_UNSCOPED",
      pathField,
      "Every retained selector branch must remain inside the canonical content root."
    );
  }
}

function collectStyles(container) {
  const styles = Array.from(container.querySelectorAll("style"));
  for (const template of container.querySelectorAll("template")) {
    styles.push(...collectStyles(template.content));
  }
  return styles;
}

function isAllowedPrintMedia(atrule) {
  if (
    atrule.name.toLowerCase() !== "media" ||
    !atrule.prelude ||
    cssTree.generate(atrule.prelude).trim() !== "print" ||
    !atrule.block
  ) {
    return false;
  }

  const children = atrule.block.children.toArray();
  return children.length > 0 && children.every(child => child.type === "Rule");
}

function collectMarkedRoots(container) {
  const marked = Array.from(container.querySelectorAll(`[${ROOT_ATTRIBUTE}]`));
  for (const template of container.querySelectorAll("template")) {
    marked.push(...collectMarkedRoots(template.content));
  }
  return marked;
}

function isNeutralRootSelector(node) {
  return node?.type === "AttributeSelector" &&
    node.name.type === "Identifier" &&
    cssTree.ident.decode(node.name.name).toLowerCase() === ROOT_ATTRIBUTE &&
    node.matcher === null &&
    node.value === null &&
    node.flags === null;
}

export function validateRegressionEvidence(evidence, options = {}) {
  try {
    return validateObject(evidence, options);
  } catch {
    return [failure(
      "EVIDENCE_VALIDATION_FAILED",
      "$",
      "Evidence validation could not complete safely."
    )];
  }
}
