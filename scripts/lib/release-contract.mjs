import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  writeFileSync
} from "node:fs";
import { basename, resolve, sep } from "node:path";

export const MAX_RELEASE_FAILURES = 32;
export const RELEASE_INPUT_FILES = Object.freeze([
  "vss-extension.json",
  "package.json",
  "package-lock.json"
]);

export const EXPECTED_RELEASE_SCRIPTS = Object.freeze({
  clean: "node scripts/clean-generated.mjs",
  typecheck: "tsc --noEmit",
  build: "npm run clean && webpack --mode production",
  "build:harness": "npm run clean && webpack --mode development --env harness",
  "check:build-outputs": "node scripts/check-build-outputs.mjs",
  "build:dev": "npm run clean && webpack --mode development",
  test: "vitest run",
  "test:watch": "vitest",
  "audit:prod": "npm audit --omit=dev",
  "check:release": "node scripts/check-release-contract.mjs",
  "package:vsix":
    "npm run build && npm run check:release && node scripts/package-vsix.mjs && node scripts/verify-vsix.mjs",
  verify:
    "npm run typecheck && npm test && npm run build && npm run check:build-outputs -- production && npm run build:harness && npm run check:build-outputs -- harness && npm run package:vsix"
});

export const EXPECTED_RELEASE_DEPENDENCIES = Object.freeze({
  "azure-devops-extension-api": "4.266.0",
  "azure-devops-extension-sdk": "4.2.0",
  "css-tree": "3.2.1",
  dompurify: "3.4.13",
  roosterjs: "9.45.2"
});

export const EXPECTED_RELEASE_DEV_DEPENDENCIES = Object.freeze({
  "@types/css-tree": "3.2.0",
  "@types/node": "24.5.2",
  jsdom: "26.1.0",
  rimraf: "6.0.1",
  "tfx-cli": "0.23.1",
  "ts-loader": "9.5.4",
  typescript: "5.9.2",
  vitest: "^4.1.2",
  webpack: "^5.105.4",
  "webpack-cli": "6.0.1"
});

const EXPECTED_INSTALLED_DIRECT_VERSIONS = Object.freeze({
  "azure-devops-extension-api": "4.266.0",
  "azure-devops-extension-sdk": "4.2.0",
  "css-tree": "3.2.1",
  dompurify: "3.4.13",
  roosterjs: "9.45.2",
  "@types/css-tree": "3.2.0",
  "@types/node": "24.5.2",
  jsdom: "26.1.0",
  rimraf: "6.0.1",
  "tfx-cli": "0.23.1",
  "ts-loader": "9.5.4",
  typescript: "5.9.2",
  vitest: "4.1.2",
  webpack: "5.105.4",
  "webpack-cli": "6.0.1"
});

const EXPECTED_PACKAGE_DESCRIPTION =
  "Azure DevOps work item custom control using RoosterJS for System.Description";
const EXPECTED_EXTENSION_DESCRIPTION =
  "Adds a RoosterJS-based rich editor control for System.Description on selected work item types.";
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const MAX_RELEASE_INPUT_BYTES = 8 * 1024 * 1024;

export class BoundedFileReadError extends Error {
  constructor(reason) {
    super(reason);
    this.name = "BoundedFileReadError";
    this.reason = reason;
  }
}

class ReleaseInputError extends Error {
  constructor(code) {
    super(code);
    this.name = "ReleaseInputError";
    this.code = code;
  }
}

function releaseInputError(code) {
  throw new ReleaseInputError(code);
}

function boundedFileReadError(reason) {
  throw new BoundedFileReadError(reason);
}

function failure(code, message) {
  return Object.freeze({ code, message });
}

function pushFailure(failures, code, message) {
  if (failures.length < MAX_RELEASE_FAILURES) {
    failures.push(failure(code, message));
  }
}

function isDataProperty(object, key) {
  if (object === null || typeof object !== "object") {
    return false;
  }
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  return Boolean(
    descriptor &&
    Object.prototype.hasOwnProperty.call(descriptor, "value") &&
    descriptor.enumerable
  );
}

function isPlainDataObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    return false;
  }
  return Reflect.ownKeys(value).every(
    key => typeof key === "string" && isDataProperty(value, key)
  );
}

function hasExactArrayShape(actual, expected) {
  if (!Array.isArray(actual) || actual.length !== expected.length) {
    return false;
  }
  const expectedKeys = expected.map((_value, index) => String(index)).concat("length");
  if (!sameStringList(Reflect.ownKeys(actual), expectedKeys)) {
    return false;
  }
  for (let index = 0; index < expected.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(actual, String(index));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      return false;
    }
    if (!hasExactShape(descriptor.value, expected[index])) {
      return false;
    }
  }
  return true;
}

function sameStringList(actual, expected) {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function hasExactShape(actual, expected) {
  if (Array.isArray(expected)) {
    return hasExactArrayShape(actual, expected);
  }
  if (expected !== null && typeof expected === "object") {
    if (!isPlainDataObject(actual)) {
      return false;
    }
    const expectedKeys = Object.keys(expected);
    if (!sameStringList(Reflect.ownKeys(actual), expectedKeys)) {
      return false;
    }
    return expectedKeys.every(key => hasExactShape(actual[key], expected[key]));
  }
  return Object.is(actual, expected);
}

function expectedManifest(version) {
  return {
    manifestVersion: 1,
    id: "roosterjs-description-editor",
    publisher: "ygdb121",
    version,
    name: "Rooster Description Editor",
    description: EXPECTED_EXTENSION_DESCRIPTION,
    public: false,
    categories: ["Plan and track"],
    targets: [{ id: "Microsoft.VisualStudio.Services" }],
    scopes: ["vso.work_write"],
    files: [
      { path: "static", addressable: true },
      { path: "dist", addressable: true }
    ],
    contributions: [
      {
        id: "rooster-description-control",
        type: "ms.vss-work-web.work-item-form-control",
        description: "RoosterJS editor for System.Description",
        targets: ["ms.vss-work-web.work-item-form"],
        properties: {
          name: "Description (Rooster)",
          uri: "static/control.html",
          height: 570,
          inputs: [
            {
              id: "FieldName",
              description: "Target field reference name.",
              type: "WorkItemField",
              properties: { workItemFieldTypes: ["HTML"] },
              validation: { dataType: "String", isRequired: true }
            },
            {
              id: "EnabledWits",
              description: "Comma-separated list of enabled work item types.",
              validation: { dataType: "String", isRequired: true }
            },
            {
              id: "DebounceMs",
              description: "Autosync debounce value in milliseconds.",
              validation: { dataType: "String", isRequired: false }
            },
            {
              id: "EnableMarkdownAutoformat",
              description: "Enable markdown auto-format shortcuts.",
              validation: { dataType: "String", isRequired: false }
            },
            {
              id: "EnableCodeBlock",
              description: "Enable code block toolbar action.",
              validation: { dataType: "String", isRequired: false }
            }
          ]
        }
      }
    ]
  };
}

function expectedPackage(version) {
  return {
    name: "roosterjs-ado-ext",
    version,
    private: true,
    description: EXPECTED_PACKAGE_DESCRIPTION,
    scripts: { ...EXPECTED_RELEASE_SCRIPTS },
    dependencies: { ...EXPECTED_RELEASE_DEPENDENCIES },
    devDependencies: { ...EXPECTED_RELEASE_DEV_DEPENDENCIES }
  };
}

function validVersion(value) {
  return typeof value === "string" && SEMVER_PATTERN.test(value);
}

function getOwnDataValue(object, key) {
  if (!isDataProperty(object, key)) {
    return undefined;
  }
  return Object.getOwnPropertyDescriptor(object, key).value;
}

function validateLockShape(packageLock, failures) {
  if (!isPlainDataObject(packageLock)) {
    pushFailure(failures, "LOCK_CONTRACT_INVALID", "Package lock contract is invalid.");
    return null;
  }
  if (!sameStringList(Reflect.ownKeys(packageLock), [
    "name",
    "version",
    "lockfileVersion",
    "requires",
    "packages"
  ])) {
    pushFailure(failures, "LOCK_CONTRACT_INVALID", "Package lock contract is invalid.");
    return null;
  }

  const name = getOwnDataValue(packageLock, "name");
  const version = getOwnDataValue(packageLock, "version");
  const lockfileVersion = getOwnDataValue(packageLock, "lockfileVersion");
  const requires = getOwnDataValue(packageLock, "requires");
  const packages = getOwnDataValue(packageLock, "packages");
  if (
    name !== "roosterjs-ado-ext" ||
    !validVersion(version) ||
    lockfileVersion !== 3 ||
    requires !== true ||
    !isPlainDataObject(packages)
  ) {
    pushFailure(failures, "LOCK_CONTRACT_INVALID", "Package lock contract is invalid.");
    return null;
  }

  const rootPackage = getOwnDataValue(packages, "");
  if (!validVersion(getOwnDataValue(rootPackage, "version"))) {
    pushFailure(failures, "LOCK_CONTRACT_INVALID", "Package lock contract is invalid.");
    return null;
  }
  const expectedRoot = {
    name: "roosterjs-ado-ext",
    version: getOwnDataValue(rootPackage, "version"),
    dependencies: { ...EXPECTED_RELEASE_DEPENDENCIES },
    devDependencies: { ...EXPECTED_RELEASE_DEV_DEPENDENCIES }
  };
  if (!hasExactShape(rootPackage, expectedRoot)) {
    pushFailure(failures, "LOCK_CONTRACT_INVALID", "Package lock contract is invalid.");
  }

  for (const [nameKey, installedVersion] of Object.entries(EXPECTED_INSTALLED_DIRECT_VERSIONS)) {
    const installedPackage = getOwnDataValue(packages, `node_modules/${nameKey}`);
    if (
      !isPlainDataObject(installedPackage) ||
      getOwnDataValue(installedPackage, "version") !== installedVersion
    ) {
      pushFailure(
        failures,
        "DEPENDENCY_CONTRACT_INVALID",
        "A direct installed dependency version is invalid."
      );
      break;
    }
  }

  const systemArchitecture = getOwnDataValue(packages, "node_modules/system-architecture");
  if (
    !isPlainDataObject(systemArchitecture) ||
    getOwnDataValue(systemArchitecture, "version") !== "0.1.0"
  ) {
    pushFailure(
      failures,
      "UNRELATED_LOCK_VERSION_INVALID",
      "An unrelated lock package version is invalid."
    );
  }

  return {
    version,
    rootVersion: getOwnDataValue(rootPackage, "version"),
    packages
  };
}

export function validateReleaseContract(data, options = {}) {
  const failures = [];
  const manifest = getOwnDataValue(data, "manifest");
  const packageJson = getOwnDataValue(data, "packageJson");
  const packageLock = getOwnDataValue(data, "packageLock");

  const manifestVersion = getOwnDataValue(manifest, "version");
  if (!validVersion(manifestVersion) || !hasExactShape(manifest, expectedManifest(manifestVersion))) {
    pushFailure(failures, "MANIFEST_CONTRACT_INVALID", "Extension manifest contract is invalid.");
  }

  const packageVersion = getOwnDataValue(packageJson, "version");
  if (!validVersion(packageVersion) || !hasExactShape(packageJson, expectedPackage(packageVersion))) {
    pushFailure(failures, "PACKAGE_CONTRACT_INVALID", "Package contract is invalid.");
  }

  const lock = validateLockShape(packageLock, failures);

  if (
    !options.allowVersionMismatch &&
    validVersion(manifestVersion) &&
    (
      packageVersion !== manifestVersion ||
      lock?.version !== manifestVersion ||
      lock?.rootVersion !== manifestVersion
    )
  ) {
    pushFailure(failures, "VERSION_MISMATCH", "Release version mirrors are not aligned.");
  }

  return Object.freeze({
    failures: Object.freeze(failures),
    version: validVersion(manifestVersion) ? manifestVersion : null,
    publisher:
      getOwnDataValue(manifest, "publisher") === "ygdb121" ? "ygdb121" : null,
    extensionId:
      getOwnDataValue(manifest, "id") === "roosterjs-description-editor"
        ? "roosterjs-description-editor"
        : null
  });
}

function locationKey(path) {
  return JSON.stringify(path);
}

function parseJsonDocument(source) {
  if (typeof source !== "string" || Buffer.byteLength(source) > MAX_RELEASE_INPUT_BYTES) {
    throw new Error("invalid JSON document");
  }

  let index = 0;
  const locations = new Map();

  function skipWhitespace() {
    while (index < source.length && /[\t\n\r ]/.test(source[index])) {
      index += 1;
    }
  }

  function parseString(path, recordLocation) {
    if (source[index] !== '"') {
      throw new Error("invalid JSON string");
    }
    const start = index;
    index += 1;
    let escaped = false;
    while (index < source.length) {
      const character = source[index];
      index += 1;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (character === '"') {
        const end = index;
        const value = JSON.parse(source.slice(start, end));
        if (recordLocation) {
          locations.set(locationKey(path), { start, end, value });
        }
        return value;
      }
      if (character.charCodeAt(0) < 0x20) {
        throw new Error("invalid JSON string");
      }
    }
    throw new Error("unterminated JSON string");
  }

  function parseValue(path, depth) {
    if (depth > 100) {
      throw new Error("JSON nesting limit exceeded");
    }
    skipWhitespace();
    const character = source[index];
    if (character === '"') {
      return parseString(path, true);
    }
    if (character === "{") {
      index += 1;
      const object = {};
      const seen = new Set();
      skipWhitespace();
      if (source[index] === "}") {
        index += 1;
        return object;
      }
      while (index < source.length) {
        skipWhitespace();
        const key = parseString([], false);
        if (seen.has(key)) {
          throw new Error("duplicate JSON property");
        }
        seen.add(key);
        skipWhitespace();
        if (source[index] !== ":") {
          throw new Error("invalid JSON object");
        }
        index += 1;
        const value = parseValue(path.concat(key), depth + 1);
        Object.defineProperty(object, key, {
          configurable: true,
          enumerable: true,
          value,
          writable: true
        });
        skipWhitespace();
        if (source[index] === "}") {
          index += 1;
          return object;
        }
        if (source[index] !== ",") {
          throw new Error("invalid JSON object");
        }
        index += 1;
      }
      throw new Error("unterminated JSON object");
    }
    if (character === "[") {
      index += 1;
      const array = [];
      skipWhitespace();
      if (source[index] === "]") {
        index += 1;
        return array;
      }
      let itemIndex = 0;
      while (index < source.length) {
        array.push(parseValue(path.concat(itemIndex), depth + 1));
        itemIndex += 1;
        skipWhitespace();
        if (source[index] === "]") {
          index += 1;
          return array;
        }
        if (source[index] !== ",") {
          throw new Error("invalid JSON array");
        }
        index += 1;
      }
      throw new Error("unterminated JSON array");
    }

    const start = index;
    while (index < source.length && !/[\t\n\r ,}\]]/.test(source[index])) {
      index += 1;
    }
    if (start === index) {
      throw new Error("invalid JSON value");
    }
    return JSON.parse(source.slice(start, index));
  }

  const value = parseValue([], 0);
  skipWhitespace();
  if (index !== source.length) {
    throw new Error("trailing JSON data");
  }
  return { value, locations };
}

export function parseStrictJson(source) {
  return parseJsonDocument(source).value;
}

function sameFileSnapshot(left, right) {
  return left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs;
}

export function readBoundedRegularFile(filePath, maxBytes, options = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    boundedFileReadError("invalid");
  }

  let pathStats;
  try {
    pathStats = lstatSync(filePath, { bigint: true });
  } catch {
    boundedFileReadError("invalid");
  }
  if (pathStats.isSymbolicLink() || !pathStats.isFile()) {
    boundedFileReadError("invalid");
  }
  if (pathStats.size > BigInt(maxBytes)) {
    boundedFileReadError("tooLarge");
  }

  const defaultNoFollow = typeof constants.O_NOFOLLOW === "number"
    ? constants.O_NOFOLLOW
    : 0;
  const noFollow = options.noFollowFlag ?? defaultNoFollow;
  const nonblock = typeof constants.O_NONBLOCK === "number" ? constants.O_NONBLOCK : 0;
  if (
    !Number.isInteger(noFollow) ||
    (noFollow !== 0 && noFollow !== defaultNoFollow)
  ) {
    boundedFileReadError("invalid");
  }

  let descriptor = null;
  try {
    descriptor = openSync(filePath, constants.O_RDONLY | nonblock | noFollow);
  } catch {
    boundedFileReadError("invalid");
  }

  let bytes;
  let pendingError = null;
  try {
    const openedStats = fstatSync(descriptor, { bigint: true });
    if (!openedStats.isFile() || !sameFileSnapshot(pathStats, openedStats)) {
      boundedFileReadError("invalid");
    }
    if (openedStats.size > BigInt(maxBytes)) {
      boundedFileReadError("tooLarge");
    }

    bytes = Buffer.alloc(Number(openedStats.size));
    let offset = 0;
    while (offset < bytes.length) {
      const bytesRead = readSync(
        descriptor,
        bytes,
        offset,
        bytes.length - offset,
        offset
      );
      if (bytesRead === 0) {
        boundedFileReadError("invalid");
      }
      offset += bytesRead;
    }
    if (readSync(descriptor, Buffer.alloc(1), 0, 1, offset) !== 0) {
      boundedFileReadError("invalid");
    }
    const finalStats = fstatSync(descriptor, { bigint: true });
    if (!sameFileSnapshot(openedStats, finalStats)) {
      boundedFileReadError("invalid");
    }
    const finalPathStats = lstatSync(filePath, { bigint: true });
    if (
      finalPathStats.isSymbolicLink() ||
      !finalPathStats.isFile() ||
      !sameFileSnapshot(finalStats, finalPathStats)
    ) {
      boundedFileReadError("invalid");
    }
  } catch (error) {
    pendingError = error instanceof BoundedFileReadError
      ? error
      : new BoundedFileReadError("invalid");
  }
  try {
    closeSync(descriptor);
  } catch {
    pendingError ??= new BoundedFileReadError("invalid");
  }
  if (pendingError) {
    throw pendingError;
  }
  return bytes;
}

function readReleaseFile(repositoryRoot, fileName) {
  const filePath = resolve(repositoryRoot, fileName);
  if (!filePath.startsWith(`${repositoryRoot}${sep}`) || basename(filePath) !== fileName) {
    releaseInputError("RELEASE_INPUT_INVALID");
  }

  let source;
  try {
    source = readBoundedRegularFile(filePath, MAX_RELEASE_INPUT_BYTES).toString("utf8");
  } catch (error) {
    if (error instanceof BoundedFileReadError && error.reason === "tooLarge") {
      releaseInputError("RELEASE_INPUT_TOO_LARGE");
    }
    releaseInputError("RELEASE_INPUT_INVALID");
  }

  try {
    return { filePath, source, ...parseJsonDocument(source) };
  } catch {
    releaseInputError("RELEASE_JSON_INVALID");
  }
}

function validateRepositoryRoot(repositoryRoot) {
  if (typeof repositoryRoot !== "string" || repositoryRoot.length === 0) {
    throw new Error("invalid repository root");
  }
  const resolvedRoot = resolve(repositoryRoot);
  const stats = lstatSync(resolvedRoot);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error("invalid repository root");
  }
  return resolvedRoot;
}

function readReleaseDocuments(repositoryRoot) {
  const resolvedRoot = validateRepositoryRoot(repositoryRoot);
  return {
    repositoryRoot: resolvedRoot,
    manifestDocument: readReleaseFile(resolvedRoot, "vss-extension.json"),
    packageDocument: readReleaseFile(resolvedRoot, "package.json"),
    lockDocument: readReleaseFile(resolvedRoot, "package-lock.json")
  };
}

export function readReleaseContract(repositoryRoot, options = {}) {
  let documents;
  try {
    documents = readReleaseDocuments(repositoryRoot);
  } catch (error) {
    const code = error instanceof ReleaseInputError
      ? error.code
      : "RELEASE_INPUT_INVALID";
    return Object.freeze({
      failures: Object.freeze([
        failure(
          code,
          code === "RELEASE_JSON_INVALID"
            ? "A release JSON input is invalid."
            : code === "RELEASE_INPUT_TOO_LARGE"
              ? "A release input exceeds the allowed byte size."
              : "A release input is missing or has an invalid file type."
        )
      ]),
      contract: null
    });
  }

  const data = {
    manifest: documents.manifestDocument.value,
    packageJson: documents.packageDocument.value,
    packageLock: documents.lockDocument.value
  };
  const validation = validateReleaseContract(data, options);
  const contract = Object.freeze({
    repositoryRoot: documents.repositoryRoot,
    manifest: data.manifest,
    packageJson: data.packageJson,
    packageLock: data.packageLock,
    version: validation.version,
    publisher: validation.publisher,
    extensionId: validation.extensionId,
    artifactFileName:
      validation.version && validation.publisher && validation.extensionId
        ? `${validation.publisher}.${validation.extensionId}-${validation.version}.vsix`
        : null
  });
  return Object.freeze({ failures: validation.failures, contract });
}

function replaceStringValues(source, locations, replacements) {
  const edits = replacements.map(({ path, value }) => {
    const location = locations.get(locationKey(path));
    if (!location || typeof location.value !== "string") {
      throw new Error("missing release version location");
    }
    return { start: location.start, end: location.end, replacement: JSON.stringify(value) };
  }).sort((left, right) => right.start - left.start);

  let next = source;
  for (const edit of edits) {
    next = `${next.slice(0, edit.start)}${edit.replacement}${next.slice(edit.end)}`;
  }
  return next;
}

export function syncReleaseVersion(repositoryRoot) {
  let documents;
  try {
    documents = readReleaseDocuments(repositoryRoot);
  } catch {
    throw new Error("Release synchronization blocked.");
  }

  const data = {
    manifest: documents.manifestDocument.value,
    packageJson: documents.packageDocument.value,
    packageLock: documents.lockDocument.value
  };
  const validation = validateReleaseContract(data, { allowVersionMismatch: true });
  if (validation.failures.length > 0 || !validation.version) {
    throw new Error("Release synchronization blocked.");
  }

  const packageSource = replaceStringValues(
    documents.packageDocument.source,
    documents.packageDocument.locations,
    [{ path: ["version"], value: validation.version }]
  );
  const lockSource = replaceStringValues(
    documents.lockDocument.source,
    documents.lockDocument.locations,
    [
      { path: ["version"], value: validation.version },
      { path: ["packages", "", "version"], value: validation.version }
    ]
  );

  const packageChanged = packageSource !== documents.packageDocument.source;
  const lockChanged = lockSource !== documents.lockDocument.source;
  try {
    if (packageChanged) {
      writeFileSync(documents.packageDocument.filePath, packageSource, "utf8");
    }
    if (lockChanged) {
      writeFileSync(documents.lockDocument.filePath, lockSource, "utf8");
    }
  } catch {
    try {
      writeFileSync(
        documents.packageDocument.filePath,
        documents.packageDocument.source,
        "utf8"
      );
    } catch {
      // Best-effort rollback continues with the other prevalidated mirror.
    }
    try {
      writeFileSync(
        documents.lockDocument.filePath,
        documents.lockDocument.source,
        "utf8"
      );
    } catch {
      // If this write was the failure point, its original bytes remain in place.
    }
    throw new Error("Release synchronization blocked.");
  }

  return Object.freeze({
    changed: packageChanged || lockChanged,
    version: validation.version
  });
}

export function formatReleaseFailures(failures) {
  const bounded = Array.isArray(failures)
    ? failures.slice(0, MAX_RELEASE_FAILURES)
    : [];
  return bounded.map(item => `${item.code}: ${item.message}`);
}
