import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync
} from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { inflateRawSync } from "node:zlib";
import { JSDOM } from "jsdom";
import {
  BoundedFileReadError,
  parseStrictJson,
  readBoundedRegularFile,
  readReleaseContract
} from "./release-contract.mjs";

export const MAX_VSIX_ARCHIVE_BYTES = 16 * 1024 * 1024;
export const MAX_VSIX_ENTRY_BYTES = 8 * 1024 * 1024;
export const MAX_VSIX_TOTAL_UNCOMPRESSED_BYTES = 16 * 1024 * 1024;
export const EXPECTED_VSIX_FILES = Object.freeze([
  "[Content_Types].xml",
  "extension.vsixmanifest",
  "extension.vsomanifest",
  "static/control.html",
  "static/control.css",
  "dist/control.js",
  "dist/control.js.LICENSE.txt"
]);
export const EXPECTED_VSIX_DIRECTORIES = Object.freeze(["static/", "dist/"]);
export const EXPECTED_VSIX_ENTRIES = Object.freeze([
  ...EXPECTED_VSIX_FILES,
  ...EXPECTED_VSIX_DIRECTORIES
]);

const EXPECTED_FILE_SET = new Set(EXPECTED_VSIX_FILES);
const EXPECTED_DIRECTORY_SET = new Set(EXPECTED_VSIX_DIRECTORIES);
const EXPECTED_ENTRY_SET = new Set(EXPECTED_VSIX_ENTRIES);
const PAYLOAD_PATHS = Object.freeze([
  "static/control.html",
  "static/control.css",
  "dist/control.js",
  "dist/control.js.LICENSE.txt"
]);

class VsixContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "VsixContractError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new VsixContractError(code, message);
}

function asFailure(error) {
  if (error instanceof VsixContractError) {
    return Object.freeze({ code: error.code, message: error.message });
  }
  return Object.freeze({ code: "VSIX_VERIFICATION_FAILED", message: "VSIX verification failed." });
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function readUInt16(buffer, offset) {
  if (offset < 0 || offset + 2 > buffer.length) {
    fail("ZIP_TRUNCATED", "VSIX ZIP structure is truncated.");
  }
  return buffer.readUInt16LE(offset);
}

function readUInt32(buffer, offset) {
  if (offset < 0 || offset + 4 > buffer.length) {
    fail("ZIP_TRUNCATED", "VSIX ZIP structure is truncated.");
  }
  return buffer.readUInt32LE(offset);
}

function findEndOfCentralDirectory(buffer) {
  if (buffer.length < 22) {
    fail("ZIP_TRUNCATED", "VSIX ZIP structure is truncated.");
  }
  const lowerBound = Math.max(0, buffer.length - 22 - 0xffff);
  for (let offset = buffer.length - 22; offset >= lowerBound; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }
  fail("ZIP_TRUNCATED", "VSIX ZIP structure is truncated.");
}

function decodeRawName(bytes) {
  if (
    bytes.length === 0 ||
    bytes.length > 256 ||
    [...bytes].some(byte => byte < 0x20 || byte > 0x7e)
  ) {
    fail("ZIP_ENTRY_NAME_INVALID", "VSIX contains an invalid raw entry name.");
  }
  const name = bytes.toString("ascii");
  if (
    name.startsWith("/") ||
    name.includes("\\") ||
    name.includes("//") ||
    name.split("/").some(segment => segment === "" && !name.endsWith("/") || segment === "." || segment === "..")
  ) {
    fail("ZIP_ENTRY_NAME_INVALID", "VSIX contains an invalid raw entry name.");
  }
  return name;
}

function validateEntryType(entry) {
  const expectedDirectory = EXPECTED_DIRECTORY_SET.has(entry.name);
  const nameIsDirectory = entry.name.endsWith("/");
  const dosDirectory = (entry.externalAttributes & 0xff) === 0x10;
  if (expectedDirectory !== nameIsDirectory || expectedDirectory !== dosDirectory) {
    fail("ZIP_ENTRY_TYPE_INVALID", "VSIX entry type does not match its contract.");
  }

  const unixMode = entry.externalAttributes >>> 16;
  const unixType = unixMode & 0o170000;
  const expectedType = expectedDirectory ? 0o040000 : 0o100000;
  if (unixType !== 0 && unixType !== expectedType) {
    fail("ZIP_ENTRY_TYPE_INVALID", "VSIX contains a symbolic-link or special-file entry.");
  }

  if (expectedDirectory && (entry.compressedSize !== 0 || entry.uncompressedSize !== 0)) {
    fail("ZIP_ENTRY_TYPE_INVALID", "VSIX directory entries must be empty.");
  }
}

function validateZipFlags(flags) {
  if ((flags & 0x0001) !== 0 || (flags & 0x0008) !== 0 || (flags & ~0x0800) !== 0) {
    fail("ZIP_FLAGS_UNSUPPORTED", "VSIX uses unsupported ZIP flags.");
  }
}

export function parseRawVsix(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > MAX_VSIX_ARCHIVE_BYTES) {
    fail("VSIX_SIZE_INVALID", "VSIX archive byte size is outside the allowed bound.");
  }

  const eocdOffset = findEndOfCentralDirectory(buffer);
  const diskNumber = readUInt16(buffer, eocdOffset + 4);
  const centralDiskNumber = readUInt16(buffer, eocdOffset + 6);
  const diskEntryCount = readUInt16(buffer, eocdOffset + 8);
  const entryCount = readUInt16(buffer, eocdOffset + 10);
  const centralSize = readUInt32(buffer, eocdOffset + 12);
  const centralOffset = readUInt32(buffer, eocdOffset + 16);
  const commentLength = readUInt16(buffer, eocdOffset + 20);

  if (eocdOffset + 22 + commentLength !== buffer.length) {
    fail("ZIP_TRUNCATED", "VSIX ZIP structure is truncated.");
  }
  if (commentLength !== 0) {
    fail("ZIP_COMMENT_UNSUPPORTED", "VSIX archive comments are not supported.");
  }
  if (diskNumber !== 0 || centralDiskNumber !== 0 || diskEntryCount !== entryCount) {
    fail("ZIP_MULTIDISK_UNSUPPORTED", "Multi-disk VSIX archives are not supported.");
  }
  if (
    diskEntryCount === 0xffff ||
    entryCount === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  ) {
    fail("ZIP64_UNSUPPORTED", "ZIP64 VSIX archives are not supported.");
  }
  if (entryCount !== EXPECTED_VSIX_ENTRIES.length) {
    fail("ZIP_ENTRY_COUNT_INVALID", "VSIX must contain exactly nine raw entries.");
  }
  if (centralOffset + centralSize !== eocdOffset || centralOffset > buffer.length) {
    fail("ZIP_TRUNCATED", "VSIX central directory is invalid.");
  }

  const entries = [];
  const rawNames = new Set();
  let cursor = centralOffset;
  let totalUncompressed = 0;
  for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
    if (readUInt32(buffer, cursor) !== 0x02014b50) {
      fail("ZIP_TRUNCATED", "VSIX central directory is invalid.");
    }
    const versionMadeBy = readUInt16(buffer, cursor + 4);
    const flags = readUInt16(buffer, cursor + 8);
    const method = readUInt16(buffer, cursor + 10);
    const crc = readUInt32(buffer, cursor + 16);
    const compressedSize = readUInt32(buffer, cursor + 20);
    const uncompressedSize = readUInt32(buffer, cursor + 24);
    const nameLength = readUInt16(buffer, cursor + 28);
    const extraLength = readUInt16(buffer, cursor + 30);
    const commentLengthForEntry = readUInt16(buffer, cursor + 32);
    const diskStart = readUInt16(buffer, cursor + 34);
    const externalAttributes = readUInt32(buffer, cursor + 38);
    const localOffset = readUInt32(buffer, cursor + 42);
    const variableEnd = cursor + 46 + nameLength + extraLength + commentLengthForEntry;
    if (variableEnd > centralOffset + centralSize) {
      fail("ZIP_TRUNCATED", "VSIX central directory is invalid.");
    }

    validateZipFlags(flags);
    if (method !== 0 && method !== 8) {
      fail("ZIP_COMPRESSION_UNSUPPORTED", "VSIX uses an unsupported compression method.");
    }
    if (extraLength !== 0) {
      fail("ZIP_EXTRA_FIELD_UNSUPPORTED", "VSIX path or ZIP extra fields are not supported.");
    }
    if (commentLengthForEntry !== 0 || diskStart !== 0) {
      fail("ZIP_MULTIDISK_UNSUPPORTED", "VSIX central entry metadata is unsupported.");
    }
    if (
      compressedSize > MAX_VSIX_ENTRY_BYTES ||
      uncompressedSize > MAX_VSIX_ENTRY_BYTES ||
      totalUncompressed + uncompressedSize > MAX_VSIX_TOTAL_UNCOMPRESSED_BYTES
    ) {
      fail("ZIP_SIZE_INVALID", "VSIX entry sizes exceed the allowed bound.");
    }

    const nameBytes = buffer.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = decodeRawName(nameBytes);
    if (rawNames.has(name)) {
      fail("ZIP_ENTRY_DUPLICATE", "VSIX contains a duplicate raw entry name.");
    }
    rawNames.add(name);
    if (!EXPECTED_ENTRY_SET.has(name)) {
      fail("ZIP_ENTRY_NAME_INVALID", "VSIX contains an unexpected raw entry name.");
    }

    const entry = {
      name,
      nameBytes: Buffer.from(nameBytes),
      versionMadeBy,
      flags,
      method,
      crc,
      compressedSize,
      uncompressedSize,
      externalAttributes,
      localOffset,
      dataStart: null,
      dataEnd: null,
      data: null
    };
    validateEntryType(entry);
    entries.push(entry);
    totalUncompressed += uncompressedSize;
    cursor = variableEnd;
  }

  if (cursor !== centralOffset + centralSize) {
    fail("ZIP_TRUNCATED", "VSIX central directory size is invalid.");
  }
  if (!EXPECTED_VSIX_ENTRIES.every(name => rawNames.has(name))) {
    fail("ZIP_ENTRY_NAME_INVALID", "VSIX raw entry set is incomplete.");
  }

  const ranges = [];
  for (const entry of entries) {
    const offset = entry.localOffset;
    if (readUInt32(buffer, offset) !== 0x04034b50) {
      fail("ZIP_LOCAL_HEADER_INVALID", "VSIX local ZIP header is invalid.");
    }
    const localFlags = readUInt16(buffer, offset + 6);
    const localMethod = readUInt16(buffer, offset + 8);
    const localCrc = readUInt32(buffer, offset + 14);
    const localCompressedSize = readUInt32(buffer, offset + 18);
    const localUncompressedSize = readUInt32(buffer, offset + 22);
    const localNameLength = readUInt16(buffer, offset + 26);
    const localExtraLength = readUInt16(buffer, offset + 28);
    const localVariableEnd = offset + 30 + localNameLength + localExtraLength;
    if (localVariableEnd > centralOffset) {
      fail("ZIP_LOCAL_HEADER_INVALID", "VSIX local ZIP header is invalid.");
    }
    const localNameBytes = buffer.subarray(offset + 30, offset + 30 + localNameLength);
    if (
      !localNameBytes.equals(entry.nameBytes) ||
      localFlags !== entry.flags ||
      localMethod !== entry.method ||
      localCrc !== entry.crc ||
      localCompressedSize !== entry.compressedSize ||
      localUncompressedSize !== entry.uncompressedSize
    ) {
      fail("ZIP_LOCAL_HEADER_INVALID", "VSIX local and central ZIP headers disagree.");
    }
    if (localExtraLength !== 0) {
      fail("ZIP_EXTRA_FIELD_UNSUPPORTED", "VSIX local ZIP extra fields are not supported.");
    }
    const dataStart = localVariableEnd;
    const dataEnd = dataStart + entry.compressedSize;
    if (dataEnd > centralOffset) {
      fail("ZIP_LOCAL_HEADER_INVALID", "VSIX local ZIP payload range is invalid.");
    }
    entry.dataStart = dataStart;
    entry.dataEnd = dataEnd;
    ranges.push({ start: offset, end: dataEnd });
  }

  ranges.sort((left, right) => left.start - right.start);
  let expectedStart = 0;
  for (const range of ranges) {
    if (range.start !== expectedStart || range.end < range.start) {
      fail("ZIP_LOCAL_HEADER_INVALID", "VSIX local ZIP records overlap or contain gaps.");
    }
    expectedStart = range.end;
  }
  if (expectedStart !== centralOffset) {
    fail("ZIP_LOCAL_HEADER_INVALID", "VSIX local ZIP records do not cover the archive payload.");
  }

  const dataByName = new Map();
  for (const entry of entries) {
    const compressed = buffer.subarray(entry.dataStart, entry.dataEnd);
    let data;
    let compressedBytesConsumed = compressed.length;
    try {
      if (entry.method === 0) {
        data = Buffer.from(compressed);
      } else {
        const inflated = inflateRawSync(compressed, {
          info: true,
          maxOutputLength: entry.uncompressedSize + 1
        });
        data = inflated.buffer;
        compressedBytesConsumed = inflated.engine.bytesWritten;
      }
    } catch {
      fail("ZIP_DECOMPRESSION_INVALID", "VSIX entry decompression failed.");
    }
    if (compressedBytesConsumed !== compressed.length) {
      fail("ZIP_DECOMPRESSION_INVALID", "VSIX entry decompression failed.");
    }
    if (
      data.length !== entry.uncompressedSize ||
      (entry.method === 0 && entry.compressedSize !== entry.uncompressedSize)
    ) {
      fail("ZIP_SIZE_INVALID", "VSIX entry size metadata is invalid.");
    }
    if (crc32(data) !== entry.crc) {
      fail("ZIP_CRC_INVALID", "VSIX entry CRC is invalid.");
    }
    entry.data = data;
    dataByName.set(entry.name, data);
  }

  return Object.freeze({
    entries: Object.freeze(entries.map(entry => Object.freeze({ ...entry }))),
    dataByName
  });
}

function isPlainDataObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    return false;
  }
  return Reflect.ownKeys(value).every(key => {
    if (typeof key !== "string") {
      return false;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor && descriptor.enumerable;
  });
}

function exactDataShape(actual, expected) {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) {
      return false;
    }
    if (Reflect.ownKeys(actual).length !== expected.length + 1) {
      return false;
    }
    return expected.every((value, index) => exactDataShape(actual[index], value));
  }
  if (expected !== null && typeof expected === "object") {
    if (!isPlainDataObject(actual)) {
      return false;
    }
    const actualKeys = Reflect.ownKeys(actual);
    const expectedKeys = Object.keys(expected);
    if (
      actualKeys.length !== expectedKeys.length ||
      actualKeys.some((key, index) => key !== expectedKeys[index])
    ) {
      return false;
    }
    return expectedKeys.every(key => exactDataShape(actual[key], expected[key]));
  }
  return Object.is(actual, expected);
}

function elementChildren(element) {
  return [...element.childNodes].filter(node => {
    if (node.nodeType === node.TEXT_NODE) {
      return node.textContent.trim().length > 0;
    }
    return true;
  });
}

function exactAttributes(element, expected) {
  const actual = Object.fromEntries([...element.attributes].map(attribute => [attribute.name, attribute.value]));
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index]) &&
    expectedKeys.every(key => actual[key] === expected[key])
  );
}

function onlyElements(element, expectedNames) {
  const children = elementChildren(element);
  return (
    children.length === expectedNames.length &&
    children.every((child, index) =>
      child.nodeType === child.ELEMENT_NODE && child.tagName === expectedNames[index]
    )
  ) ? children : null;
}

function exactTextElement(element, expectedText, expectedAttributes = {}) {
  return (
    exactAttributes(element, expectedAttributes) &&
    [...element.childNodes].every(node => node.nodeType === node.TEXT_NODE) &&
    element.textContent === expectedText
  );
}

function parseXmlDocument(source, code, message) {
  let document;
  try {
    document = new JSDOM(source, { contentType: "text/xml" }).window.document;
  } catch {
    fail(code, message);
  }
  if (
    document.doctype !== null ||
    [...document.childNodes].some(node => node !== document.documentElement)
  ) {
    fail(code, message);
  }
  return document;
}

function validateContentTypes(xml) {
  const document = parseXmlDocument(
    xml,
    "CONTENT_TYPES_INVALID",
    "Effective VSIX content-types XML is invalid."
  );
  const root = document.documentElement;
  if (
    root.tagName !== "Types" ||
    root.namespaceURI !== "http://schemas.openxmlformats.org/package/2006/content-types" ||
    !exactAttributes(root, {
      xmlns: "http://schemas.openxmlformats.org/package/2006/content-types"
    })
  ) {
    fail("CONTENT_TYPES_INVALID", "Effective VSIX content-types XML is invalid.");
  }
  const defaults = onlyElements(root, ["Default", "Default", "Default", "Default", "Default", "Default"]);
  if (!defaults || defaults.some(element => elementChildren(element).length !== 0)) {
    fail("CONTENT_TYPES_INVALID", "Effective VSIX content-types XML is invalid.");
  }
  const expected = [
    { Extension: ".css", ContentType: "text/css" },
    { Extension: ".html", ContentType: "text/html" },
    { Extension: ".js", ContentType: "application/javascript" },
    { Extension: ".txt", ContentType: "text/plain" },
    { Extension: ".vsixmanifest", ContentType: "text/xml" },
    { Extension: ".vsomanifest", ContentType: "application/json" }
  ];
  const actual = defaults.map(element =>
    Object.fromEntries([...element.attributes].map(attribute => [attribute.name, attribute.value]))
  );
  const key = value => JSON.stringify(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
  if (actual.map(key).sort().join("\n") !== expected.map(key).sort().join("\n")) {
    fail("CONTENT_TYPES_INVALID", "Effective VSIX content-types XML is invalid.");
  }
}

function validateEffectiveVsixManifest(xml, contract) {
  const document = parseXmlDocument(
    xml,
    "VSIX_MANIFEST_INVALID",
    "Effective VSIX XML manifest is invalid."
  );
  const root = document.documentElement;
  if (
    root.tagName !== "PackageManifest" ||
    root.namespaceURI !== "http://schemas.microsoft.com/developer/vsx-schema/2011" ||
    !exactAttributes(root, {
      Version: "2.0.0",
      xmlns: "http://schemas.microsoft.com/developer/vsx-schema/2011",
      "xmlns:d": "http://schemas.microsoft.com/developer/vsx-schema-design/2011"
    })
  ) {
    fail("VSIX_MANIFEST_INVALID", "Effective VSIX XML manifest is invalid.");
  }

  const rootChildren = onlyElements(root, ["Metadata", "Dependencies", "Installation", "Assets"]);
  if (!rootChildren) {
    fail("VSIX_MANIFEST_INVALID", "Effective VSIX XML manifest is invalid.");
  }
  const [metadata, dependencies, installation, assets] = rootChildren;
  const metadataChildren = onlyElements(metadata, [
    "Identity",
    "DisplayName",
    "Description",
    "GalleryFlags",
    "Categories"
  ]);
  if (!metadataChildren || !exactAttributes(metadata, {})) {
    fail("VSIX_MANIFEST_INVALID", "Effective VSIX XML manifest is invalid.");
  }
  const [identity, displayName, description, galleryFlags, categories] = metadataChildren;
  if (
    !exactAttributes(identity, {
      Language: "en-US",
      Id: contract.extensionId,
      Publisher: contract.publisher,
      Version: contract.version
    }) ||
    elementChildren(identity).length !== 0 ||
    !exactTextElement(displayName, "Rooster Description Editor") ||
    !exactTextElement(
      description,
      "Adds a RoosterJS-based rich editor control for System.Description on selected work item types.",
      { "xml:space": "preserve" }
    ) ||
    !exactAttributes(galleryFlags, {}) ||
    elementChildren(galleryFlags).length !== 0 ||
    !exactTextElement(categories, "Plan and track") ||
    !exactAttributes(dependencies, {}) ||
    elementChildren(dependencies).length !== 0
  ) {
    fail("VSIX_MANIFEST_INVALID", "Effective VSIX XML manifest is invalid.");
  }

  const installationChildren = onlyElements(installation, ["InstallationTarget"]);
  if (
    !installationChildren ||
    !exactAttributes(installation, {}) ||
    !exactAttributes(installationChildren[0], { Id: "Microsoft.VisualStudio.Services" }) ||
    elementChildren(installationChildren[0]).length !== 0
  ) {
    fail("VSIX_MANIFEST_INVALID", "Effective VSIX XML manifest is invalid.");
  }

  const assetElements = onlyElements(assets, ["Asset", "Asset", "Asset", "Asset", "Asset"]);
  if (!assetElements || !exactAttributes(assets, {})) {
    fail("VSIX_MANIFEST_INVALID", "Effective VSIX XML manifest is invalid.");
  }
  const expectedAssets = [
    { Type: "static/control.css", "d:Source": "File", Path: "static/control.css", Addressable: "true" },
    { Type: "static/control.html", "d:Source": "File", Path: "static/control.html", Addressable: "true" },
    { Type: "dist/control.js", "d:Source": "File", Path: "dist/control.js", Addressable: "true" },
    {
      Type: "dist/control.js.LICENSE.txt",
      "d:Source": "File",
      Path: "dist/control.js.LICENSE.txt",
      Addressable: "true"
    },
    {
      Type: "Microsoft.VisualStudio.Services.Manifest",
      "d:Source": "File",
      Path: "extension.vsomanifest",
      Addressable: "true"
    }
  ];
  const actualAssets = assetElements.map(element =>
    Object.fromEntries([...element.attributes].map(attribute => [attribute.name, attribute.value]))
  );
  const assetKey = value => JSON.stringify(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
  if (
    assetElements.some(element => elementChildren(element).length !== 0) ||
    actualAssets.map(assetKey).sort().join("\n") !== expectedAssets.map(assetKey).sort().join("\n")
  ) {
    fail("VSIX_MANIFEST_INVALID", "Effective VSIX XML manifest assets are invalid.");
  }
}

function validateEffectiveVsoManifest(source, contract) {
  let manifest;
  try {
    manifest = parseStrictJson(source);
  } catch {
    fail("VSO_MANIFEST_INVALID", "Effective VSO JSON manifest is invalid.");
  }
  const expected = {
    manifestVersion: contract.manifest.manifestVersion,
    scopes: contract.manifest.scopes,
    contributions: contract.manifest.contributions,
    contributionTypes: []
  };
  if (!exactDataShape(manifest, expected)) {
    fail("VSO_MANIFEST_INVALID", "Effective VSO JSON manifest is invalid.");
  }
}

function assertRegularFile(path, code = "REPOSITORY_SOURCE_INVALID") {
  let stats;
  try {
    stats = lstatSync(path);
  } catch {
    fail(code, "A required regular non-symlink file is invalid.");
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    fail(code, "A required regular non-symlink file is invalid.");
  }
}

function readBoundedVsixFile(path) {
  try {
    return readBoundedRegularFile(path, MAX_VSIX_ARCHIVE_BYTES);
  } catch (error) {
    if (error instanceof BoundedFileReadError && error.reason === "tooLarge") {
      fail("VSIX_FILE_TOO_LARGE", "VSIX archive exceeds the allowed byte size.");
    }
    fail("VSIX_FILE_INVALID", "VSIX must be a regular non-symlink file.");
  }
}

function readBoundedRepositorySource(path) {
  try {
    return readBoundedRegularFile(path, MAX_VSIX_ENTRY_BYTES);
  } catch (error) {
    if (error instanceof BoundedFileReadError && error.reason === "tooLarge") {
      fail(
        "REPOSITORY_SOURCE_TOO_LARGE",
        "A packaged repository source exceeds the allowed byte size."
      );
    }
    fail("REPOSITORY_SOURCE_INVALID", "A packaged repository source is invalid.");
  }
}

function readBoundedTfxPackage(path) {
  try {
    return readBoundedRegularFile(path, MAX_VSIX_ENTRY_BYTES);
  } catch (error) {
    if (error instanceof BoundedFileReadError && error.reason === "tooLarge") {
      fail(
        "LOCAL_TFX_TOO_LARGE",
        "Local tfx package metadata exceeds the allowed byte size."
      );
    }
    fail("LOCAL_TFX_INVALID", "Local tfx package metadata is invalid.");
  }
}

function assertRegularDirectory(path, code = "REPOSITORY_SOURCE_INVALID") {
  let stats;
  try {
    stats = lstatSync(path);
  } catch {
    fail(code, "A required regular non-symlink directory is invalid.");
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    fail(code, "A required regular non-symlink directory is invalid.");
  }
}

function assertExactDirectoryFiles(directory, expected) {
  assertRegularDirectory(directory);
  const entries = readdirSync(directory, { withFileTypes: true });
  const names = entries.map(entry => entry.name).sort();
  if (names.join("\n") !== [...expected].sort().join("\n")) {
    fail("REPOSITORY_SOURCE_INVALID", "A packaged source directory listing is invalid.");
  }
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink()) {
      fail("REPOSITORY_SOURCE_INVALID", "A packaged source entry type is invalid.");
    }
    assertRegularFile(resolve(directory, entry.name));
  }
}

function assertRepositoryVsixInventory(repositoryRoot, expectedPath = null) {
  const pending = [repositoryRoot];
  const vsixEntries = [];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = resolve(directory, entry.name);
      if (entry.name.toLowerCase().endsWith(".vsix")) {
        vsixEntries.push(entryPath);
      }
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        pending.push(entryPath);
      }
    }
  }

  const expected = expectedPath === null ? [] : [resolve(expectedPath)];
  vsixEntries.sort();
  expected.sort();
  if (vsixEntries.join("\n") !== expected.join("\n")) {
    fail(
      "REPOSITORY_VSIX_INVALID",
      "Repository VSIX inventory contains an unexpected artifact."
    );
  }
}

function resolveRepositoryChild(repositoryRoot, child) {
  const resolved = resolve(repositoryRoot, child);
  if (!resolved.startsWith(`${repositoryRoot}${sep}`)) {
    fail("REPOSITORY_PATH_INVALID", "A repository child path is invalid.");
  }
  return resolved;
}

export function preflightPackage(repositoryRoot) {
  const release = readReleaseContract(repositoryRoot);
  if (release.failures.length > 0 || !release.contract?.artifactFileName) {
    fail("RELEASE_CONTRACT_INVALID", "Release contract must pass before packaging.");
  }
  const contract = release.contract;
  const root = contract.repositoryRoot;

  assertRepositoryVsixInventory(root);

  for (const name of ["vss-extension.json", "package.json", "package-lock.json"]) {
    assertRegularFile(resolveRepositoryChild(root, name));
  }
  assertExactDirectoryFiles(resolveRepositoryChild(root, "static"), ["control.html", "control.css"]);
  assertExactDirectoryFiles(resolveRepositoryChild(root, "dist"), [
    "control.js",
    "control.js.LICENSE.txt"
  ]);
  for (const payloadPath of PAYLOAD_PATHS) {
    readBoundedRepositorySource(resolveRepositoryChild(root, payloadPath));
  }

  const nodeModules = resolveRepositoryChild(root, "node_modules");
  const tfxRoot = resolveRepositoryChild(root, "node_modules/tfx-cli");
  assertRegularDirectory(nodeModules, "LOCAL_TFX_INVALID");
  assertRegularDirectory(tfxRoot, "LOCAL_TFX_INVALID");
  const tfxPackagePath = resolveRepositoryChild(root, "node_modules/tfx-cli/package.json");
  let tfxPackage;
  try {
    tfxPackage = parseStrictJson(readBoundedTfxPackage(tfxPackagePath).toString("utf8"));
  } catch (error) {
    if (error instanceof VsixContractError) {
      throw error;
    }
    fail("LOCAL_TFX_INVALID", "Local tfx package metadata is invalid.");
  }
  if (
    !isPlainDataObject(tfxPackage) ||
    tfxPackage.name !== "tfx-cli" ||
    tfxPackage.version !== "0.23.1" ||
    !isPlainDataObject(tfxPackage.bin) ||
    Reflect.ownKeys(tfxPackage.bin).length !== 1 ||
    typeof tfxPackage.bin.tfx !== "string" ||
    tfxPackage.bin.tfx.length === 0 ||
    isAbsolute(tfxPackage.bin.tfx) ||
    tfxPackage.bin.tfx.includes("\\")
  ) {
    fail("LOCAL_TFX_INVALID", "Local tfx package metadata is invalid.");
  }
  const tfxEntry = resolve(tfxRoot, tfxPackage.bin.tfx);
  const relativeEntry = relative(tfxRoot, tfxEntry);
  if (
    relativeEntry === "" ||
    relativeEntry.startsWith(`..${sep}`) ||
    relativeEntry === ".." ||
    isAbsolute(relativeEntry)
  ) {
    fail("LOCAL_TFX_INVALID", "Local tfx entry path is invalid.");
  }
  let component = tfxRoot;
  for (const segment of relativeEntry.split(sep)) {
    component = resolve(component, segment);
    if (component === tfxEntry) {
      assertRegularFile(component, "LOCAL_TFX_INVALID");
    } else {
      assertRegularDirectory(component, "LOCAL_TFX_INVALID");
    }
  }

  const artifactsDirectory = resolveRepositoryChild(root, "artifacts");
  if (existsSync(artifactsDirectory)) {
    assertRegularDirectory(artifactsDirectory, "ARTIFACT_DIRECTORY_INVALID");
    if (readdirSync(artifactsDirectory).length !== 0) {
      fail("ARTIFACT_DIRECTORY_INVALID", "Artifacts directory must be empty before packaging.");
    }
  } else {
    mkdirSync(artifactsDirectory);
    assertRegularDirectory(artifactsDirectory, "ARTIFACT_DIRECTORY_INVALID");
  }
  const artifactPath = resolve(artifactsDirectory, contract.artifactFileName);

  return Object.freeze({
    contract,
    repositoryRoot: root,
    tfxEntry,
    artifactsDirectory,
    artifactPath,
    arguments: Object.freeze([
      tfxEntry,
      "extension",
      "create",
      "--root",
      root,
      "--manifest-globs",
      "vss-extension.json",
      "--output-path",
      artifactPath
    ])
  });
}

export function validatePackagedArtifact(plan) {
  assertRegularDirectory(plan.artifactsDirectory, "ARTIFACT_OUTPUT_INVALID");
  const entries = readdirSync(plan.artifactsDirectory, { withFileTypes: true });
  if (
    entries.length !== 1 ||
    entries[0].name !== plan.contract.artifactFileName ||
    !entries[0].isFile() ||
    entries[0].isSymbolicLink()
  ) {
    fail("ARTIFACT_OUTPUT_INVALID", "Packaging must leave exactly one expected VSIX artifact.");
  }
  assertRegularFile(plan.artifactPath, "ARTIFACT_OUTPUT_INVALID");
  assertRepositoryVsixInventory(plan.repositoryRoot, plan.artifactPath);
}

function expectedArtifactPath(contract) {
  return resolve(contract.repositoryRoot, "artifacts", contract.artifactFileName);
}

export function verifyVsix(options) {
  try {
    const release = readReleaseContract(options?.repositoryRoot);
    if (release.failures.length > 0 || !release.contract?.artifactFileName) {
      fail("RELEASE_CONTRACT_INVALID", "Release contract must pass before VSIX verification.");
    }
    const contract = release.contract;
    const vsixPath = resolve(options.vsixPath);
    const artifactsDirectory = resolveRepositoryChild(contract.repositoryRoot, "artifacts");
    if (
      options.allowControlledPath !== true &&
      vsixPath !== expectedArtifactPath(contract)
    ) {
      fail("VSIX_PATH_INVALID", "VSIX path does not match the derived release artifact.");
    }
    if (options.allowControlledPath !== true) {
      assertRegularDirectory(artifactsDirectory, "ARTIFACT_DIRECTORY_INVALID");
    }
    assertRegularFile(vsixPath, "VSIX_FILE_INVALID");
    assertRepositoryVsixInventory(contract.repositoryRoot, vsixPath);
    for (const sourceDirectory of ["static", "dist"]) {
      assertRegularDirectory(resolveRepositoryChild(contract.repositoryRoot, sourceDirectory));
    }

    const archive = readBoundedVsixFile(vsixPath);
    const parsed = parseRawVsix(archive);
    validateContentTypes(parsed.dataByName.get("[Content_Types].xml").toString("utf8"));
    validateEffectiveVsixManifest(
      parsed.dataByName.get("extension.vsixmanifest").toString("utf8"),
      contract
    );
    validateEffectiveVsoManifest(
      parsed.dataByName.get("extension.vsomanifest").toString("utf8"),
      contract
    );
    for (const payloadPath of PAYLOAD_PATHS) {
      const source = readBoundedRepositorySource(resolve(contract.repositoryRoot, payloadPath));
      if (!parsed.dataByName.get(payloadPath).equals(source)) {
        fail("VSIX_PAYLOAD_MISMATCH", "A packaged repository payload differs from source bytes.");
      }
    }

    return Object.freeze({
      failures: Object.freeze([]),
      report: Object.freeze({
        sha256: createHash("sha256").update(archive).digest("hex"),
        byteSize: archive.length,
        version: contract.version,
        publisher: contract.publisher,
        extensionId: contract.extensionId,
        scopes: Object.freeze([...contract.manifest.scopes]),
        entries: Object.freeze([...parsed.dataByName.keys()].sort())
      })
    });
  } catch (error) {
    return Object.freeze({
      failures: Object.freeze([asFailure(error)]),
      report: null
    });
  }
}

export function formatVsixFailure(failure) {
  return `${failure.code}: ${failure.message}`;
}
