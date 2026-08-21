import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { deflateRawSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";

interface VsixFailure {
  readonly code: string;
  readonly message: string;
}

interface VsixResult {
  readonly failures: readonly VsixFailure[];
  readonly report: null | {
    readonly sha256: string;
    readonly byteSize: number;
    readonly version: string;
    readonly publisher: string;
    readonly extensionId: string;
    readonly scopes: readonly string[];
    readonly entries: readonly string[];
  };
}

interface VsixContractModule {
  readonly MAX_VSIX_ARCHIVE_BYTES: number;
  readonly MAX_VSIX_ENTRY_BYTES: number;
  parseRawVsix(buffer: Buffer): unknown;
  verifyVsix(options: {
    readonly repositoryRoot: string;
    readonly vsixPath: string;
    readonly allowControlledPath?: boolean;
  }): VsixResult;
}

interface ZipEntry {
  readonly name: string;
  readonly data: Buffer;
  readonly compressedData?: Buffer;
  readonly directory?: boolean;
  readonly localName?: string;
  readonly centralName?: string;
  readonly flags?: number;
  readonly method?: number;
  readonly localExtra?: Buffer;
  readonly centralExtra?: Buffer;
  readonly externalAttributes?: number;
  readonly versionMadeBy?: number;
  readonly crcOverride?: number;
  readonly uncompressedSizeOverride?: number;
}

const repositoryRoot = process.cwd();
const temporaryRoots: string[] = [];
const vsixContract = await import(
  pathToFileURL(resolve("scripts/lib/vsix-contract.mjs")).href
) as unknown as VsixContractModule;

const expectedFileNames = [
  "[Content_Types].xml",
  "extension.vsixmanifest",
  "extension.vsomanifest",
  "static/control.html",
  "static/control.css",
  "dist/control.js",
  "dist/control.js.LICENSE.txt"
] as const;

const expectedDirectoryNames = ["static/", "dist/"] as const;

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildZip(entries: readonly ZipEntry[], options?: {
  readonly diskNumber?: number;
  readonly centralDiskNumber?: number;
  readonly entryCountOverride?: number;
  readonly comment?: Buffer;
}): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const localName = Buffer.from(entry.localName ?? entry.name, "utf8");
    const centralName = Buffer.from(entry.centralName ?? entry.name, "utf8");
    const localExtra = entry.localExtra ?? Buffer.alloc(0);
    const centralExtra = entry.centralExtra ?? Buffer.alloc(0);
    const flags = entry.flags ?? 0;
    const method = entry.method ?? 0;
    const data = entry.data;
    const compressedData = entry.compressedData ?? data;
    const crc = entry.crcOverride ?? crc32(data);
    const uncompressedSize = entry.uncompressedSizeOverride ?? data.length;
    const compressedSize = compressedData.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method === 0 ? 10 : 20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressedSize, 18);
    local.writeUInt32LE(uncompressedSize, 22);
    local.writeUInt16LE(localName.length, 26);
    local.writeUInt16LE(localExtra.length, 28);
    localParts.push(local, localName, localExtra, compressedData);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(entry.versionMadeBy ?? 20, 4);
    central.writeUInt16LE(method === 0 ? 10 : 20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressedSize, 20);
    central.writeUInt32LE(uncompressedSize, 24);
    central.writeUInt16LE(centralName.length, 28);
    central.writeUInt16LE(centralExtra.length, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt32LE(
      entry.externalAttributes ?? (entry.directory ? 0x10 : 0),
      38
    );
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, centralName, centralExtra);

    localOffset += local.length + localName.length + localExtra.length + compressedData.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const comment = options?.comment ?? Buffer.alloc(0);
  const eocd = Buffer.alloc(22);
  const entryCount = options?.entryCountOverride ?? entries.length;
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(options?.diskNumber ?? 0, 4);
  eocd.writeUInt16LE(options?.centralDiskNumber ?? 0, 6);
  eocd.writeUInt16LE(entryCount, 8);
  eocd.writeUInt16LE(entryCount, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(localOffset, 16);
  eocd.writeUInt16LE(comment.length, 20);
  return Buffer.concat([...localParts, centralDirectory, eocd, comment]);
}

function createRepository(): string {
  const root = mkdtempSync(join(tmpdir(), "rooster-vsix-contract-"));
  temporaryRoots.push(root);
  mkdirSync(join(root, "static"));
  mkdirSync(join(root, "dist"));
  for (const path of ["vss-extension.json", "package.json", "package-lock.json"]) {
    copyFileSync(resolve(path), join(root, path));
  }
  writeFileSync(join(root, "static/control.html"), "<!doctype html><html><body></body></html>\n");
  writeFileSync(join(root, "static/control.css"), ".rdx-app {}\n");
  writeFileSync(join(root, "dist/control.js"), "(() => {})();\n");
  writeFileSync(join(root, "dist/control.js.LICENSE.txt"), "controlled license\n");
  return root;
}

function validVsixManifest(version = "0.1.23"): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="roosterjs-description-editor" Publisher="ygdb121" Version="${version}"/>
    <DisplayName>Rooster Description Editor</DisplayName>
    <Description xml:space="preserve">Adds a RoosterJS-based rich editor control for System.Description on selected work item types.</Description>
    <GalleryFlags/>
    <Categories>Plan and track</Categories>
  </Metadata>
  <Dependencies/>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Services"/>
  </Installation>
  <Assets>
    <Asset Type="static/control.css" d:Source="File" Path="static/control.css" Addressable="true"/>
    <Asset Type="static/control.html" d:Source="File" Path="static/control.html" Addressable="true"/>
    <Asset Type="dist/control.js" d:Source="File" Path="dist/control.js" Addressable="true"/>
    <Asset Type="dist/control.js.LICENSE.txt" d:Source="File" Path="dist/control.js.LICENSE.txt" Addressable="true"/>
    <Asset Type="Microsoft.VisualStudio.Services.Manifest" d:Source="File" Path="extension.vsomanifest" Addressable="true"/>
  </Assets>
</PackageManifest>`;
}

function validVsoManifest(): Record<string, unknown> {
  const source = JSON.parse(readFileSync(resolve("vss-extension.json"), "utf8"));
  return {
    manifestVersion: 1,
    scopes: ["vso.work_write"],
    contributions: structuredClone(source.contributions),
    contributionTypes: []
  };
}

function validEntries(root: string, overrides?: Partial<Record<string, string | Buffer>>): ZipEntry[] {
  const payload = (name: string, fallback: string | Buffer): Buffer => {
    const value = overrides?.[name] ?? fallback;
    return Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  };
  return [
    {
      name: "[Content_Types].xml",
      data: payload("[Content_Types].xml", `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension=".css" ContentType="text/css"/>
  <Default Extension=".html" ContentType="text/html"/>
  <Default Extension=".js" ContentType="application/javascript"/>
  <Default Extension=".txt" ContentType="text/plain"/>
  <Default Extension=".vsixmanifest" ContentType="text/xml"/>
  <Default Extension=".vsomanifest" ContentType="application/json"/>
</Types>`)
    },
    {
      name: "extension.vsixmanifest",
      data: payload("extension.vsixmanifest", validVsixManifest())
    },
    {
      name: "extension.vsomanifest",
      data: payload("extension.vsomanifest", `${JSON.stringify(validVsoManifest(), null, 2)}\n`)
    },
    { name: "static/", data: Buffer.alloc(0), directory: true },
    {
      name: "static/control.html",
      data: payload("static/control.html", readFileSync(join(root, "static/control.html")))
    },
    {
      name: "static/control.css",
      data: payload("static/control.css", readFileSync(join(root, "static/control.css")))
    },
    { name: "dist/", data: Buffer.alloc(0), directory: true },
    {
      name: "dist/control.js",
      data: payload("dist/control.js", readFileSync(join(root, "dist/control.js")))
    },
    {
      name: "dist/control.js.LICENSE.txt",
      data: payload(
        "dist/control.js.LICENSE.txt",
        readFileSync(join(root, "dist/control.js.LICENSE.txt"))
      )
    }
  ];
}

function writeArchive(root: string, buffer: Buffer): string {
  const artifacts = join(root, "artifacts");
  mkdirSync(artifacts, { recursive: true });
  const archivePath = join(artifacts, "controlled.vsix");
  writeFileSync(archivePath, buffer);
  return archivePath;
}

function writeJsonAtExactSize(
  path: string,
  value: Record<string, unknown>,
  byteSize: number
): void {
  const json = Buffer.from(JSON.stringify(value), "utf8");
  if (json.length > byteSize) {
    throw new Error("Controlled JSON exceeds requested test size.");
  }
  writeFileSync(path, Buffer.concat([json, Buffer.alloc(byteSize - json.length, 0x20)]));
}

function verifyBuffer(root: string, buffer: Buffer): VsixResult {
  return vsixContract.verifyVsix({
    repositoryRoot: root,
    vsixPath: writeArchive(root, buffer),
    allowControlledPath: true
  });
}

function codes(result: VsixResult): string[] {
  return result.failures.map(item => item.code);
}

afterEach(() => {
  while (temporaryRoots.length > 0) {
    rmSync(temporaryRoots.pop()!, { recursive: true, force: true });
  }
});

describe("raw VSIX contract", () => {
  it("accepts exactly seven files, two directories, effective metadata, and repository bytes", () => {
    const root = createRepository();
    const archive = buildZip(validEntries(root));

    const result = verifyBuffer(root, archive);

    expect(result.failures).toEqual([]);
    expect(result.report).toEqual({
      sha256: createHash("sha256").update(archive).digest("hex"),
      byteSize: archive.length,
      version: "0.1.23",
      publisher: "ygdb121",
      extensionId: "roosterjs-description-editor",
      scopes: ["vso.work_write"],
      entries: [...expectedFileNames, ...expectedDirectoryNames].sort()
    });
  });

  it("rejects missing and extra entries before lookup", () => {
    const root = createRepository();
    expect(codes(verifyBuffer(root, buildZip(validEntries(root).slice(0, -1))))).toContain(
      "ZIP_ENTRY_COUNT_INVALID"
    );
    expect(codes(verifyBuffer(root, buildZip([
      ...validEntries(root),
      { name: "test.html", data: Buffer.from("junk") }
    ])))).toContain("ZIP_ENTRY_COUNT_INVALID");
  });

  it.each([
    ["file", 8, { name: "unexpected.txt", data: Buffer.from("junk") }],
    ["directory", 6, { name: "unexpected/", data: Buffer.alloc(0), directory: true }]
  ] as const)("rejects an unexpected %s replacing a missing expected entry", (_label, index, replacement) => {
    const root = createRepository();
    const entries = validEntries(root);
    entries[index] = replacement;
    expect(codes(verifyBuffer(root, buildZip(entries)))).toContain("ZIP_ENTRY_NAME_INVALID");
  });

  it.each([
    "dist/test-harness.js",
    "test.html",
    "src/index.ts",
    "test/fixture.html",
    "docs/readme.md",
    "node_modules/module.js",
    "dist/control.js.map",
    ".env",
    "secret.pem",
    ".DS_Store",
    "tool.exe",
    "library.dll",
    "library.so",
    "library.dylib"
  ])("rejects forbidden or unexpected archive entry %s", name => {
    const root = createRepository();
    const entries = validEntries(root);
    entries[4] = { name, data: entries[4].data };
    expect(codes(verifyBuffer(root, buildZip(entries)))).toContain("ZIP_ENTRY_NAME_INVALID");
  });

  it("rejects duplicate raw names even when a normalized map could overwrite one", () => {
    const root = createRepository();
    const entries = validEntries(root);
    entries[5] = { ...entries[5], name: "static/control.html" };
    expect(codes(verifyBuffer(root, buildZip(entries)))).toContain("ZIP_ENTRY_DUPLICATE");
  });

  it.each([
    "../static/control.html",
    "./static/control.html",
    "static//control.html",
    "/static/control.html",
    "static\\control.html",
    "static/../control.html",
    "STATIC/control.html",
    "static/control.htm\u0000l",
    "root/static/control.html"
  ])("rejects raw alias or traversal name %s", name => {
    const root = createRepository();
    const entries = validEntries(root);
    entries[4] = { ...entries[4], name };
    expect(codes(verifyBuffer(root, buildZip(entries)))).toContain("ZIP_ENTRY_NAME_INVALID");
  });

  it("rejects local and central filename mismatch", () => {
    const root = createRepository();
    const entries = validEntries(root);
    entries[4] = { ...entries[4], localName: "static/control.css" };
    expect(codes(verifyBuffer(root, buildZip(entries)))).toContain("ZIP_LOCAL_HEADER_INVALID");
  });

  it("rejects Unicode-path and other path extra fields", () => {
    const root = createRepository();
    const entries = validEntries(root);
    const unicodePathExtra = Buffer.from([0x75, 0x70, 0x01, 0x00, 0x01]);
    entries[4] = { ...entries[4], centralExtra: unicodePathExtra };
    expect(codes(verifyBuffer(root, buildZip(entries)))).toContain("ZIP_EXTRA_FIELD_UNSUPPORTED");

    const localEntries = validEntries(root);
    localEntries[4] = { ...localEntries[4], localExtra: unicodePathExtra };
    expect(codes(verifyBuffer(root, buildZip(localEntries)))).toContain(
      "ZIP_EXTRA_FIELD_UNSUPPORTED"
    );
  });

  it("rejects expected-name UNIX symlink and special-file modes", () => {
    for (const [mode, versionMadeBy] of [
      [0o120777, 0x0314],
      [0o020666, 0x0314],
      [0o120777, 0x0014]
    ] as const) {
      const root = createRepository();
      const entries = validEntries(root);
      entries[4] = {
        ...entries[4],
        versionMadeBy,
        externalAttributes: (mode << 16) >>> 0
      };
      expect(codes(verifyBuffer(root, buildZip(entries)))).toContain("ZIP_ENTRY_TYPE_INVALID");
    }
  });

  it("rejects directory/file type mismatches", () => {
    const root = createRepository();
    const directoryAsFile = validEntries(root);
    directoryAsFile[3] = { ...directoryAsFile[3], externalAttributes: 0 };
    expect(codes(verifyBuffer(root, buildZip(directoryAsFile)))).toContain("ZIP_ENTRY_TYPE_INVALID");

    const fileAsDirectory = validEntries(root);
    fileAsDirectory[4] = { ...fileAsDirectory[4], externalAttributes: 0x10 };
    expect(codes(verifyBuffer(root, buildZip(fileAsDirectory)))).toContain("ZIP_ENTRY_TYPE_INVALID");
  });

  it.each([
    ["encryption", 0x0001],
    ["data descriptor", 0x0008]
  ])("rejects unsupported %s flags", (_label, flags) => {
    const root = createRepository();
    const entries = validEntries(root);
    entries[4] = { ...entries[4], flags };
    expect(codes(verifyBuffer(root, buildZip(entries)))).toContain("ZIP_FLAGS_UNSUPPORTED");
  });

  it("rejects unsupported compression, multi-disk, ZIP64 sentinel, and archive comments", () => {
    const root = createRepository();
    const compression = validEntries(root);
    compression[4] = { ...compression[4], method: 12 };
    expect(codes(verifyBuffer(root, buildZip(compression)))).toContain("ZIP_COMPRESSION_UNSUPPORTED");
    expect(codes(verifyBuffer(root, buildZip(validEntries(root), { diskNumber: 1 })))).toContain(
      "ZIP_MULTIDISK_UNSUPPORTED"
    );
    expect(codes(verifyBuffer(root, buildZip(validEntries(root), { entryCountOverride: 0xffff })))).toContain(
      "ZIP64_UNSUPPORTED"
    );
    expect(codes(verifyBuffer(root, buildZip(validEntries(root), { comment: Buffer.from("x") })))).toContain(
      "ZIP_COMMENT_UNSUPPORTED"
    );
  });

  it("rejects truncation, bad CRC, and oversized declared content", () => {
    const root = createRepository();
    const valid = buildZip(validEntries(root));
    expect(codes(verifyBuffer(root, valid.subarray(0, valid.length - 8)))).toContain("ZIP_TRUNCATED");

    const badCrc = validEntries(root);
    badCrc[4] = { ...badCrc[4], crcOverride: 0 };
    expect(codes(verifyBuffer(root, buildZip(badCrc)))).toContain("ZIP_CRC_INVALID");

    const oversized = validEntries(root);
    oversized[4] = { ...oversized[4], uncompressedSizeOverride: 0xffffffff };
    expect(codes(verifyBuffer(root, buildZip(oversized)))).toContain("ZIP_SIZE_INVALID");
  });

  it("rejects bytes trailing a complete DEFLATE stream inside a declared entry", () => {
    const root = createRepository();
    const entries = validEntries(root);
    entries[4] = {
      ...entries[4],
      method: 8,
      compressedData: Buffer.concat([
        deflateRawSync(entries[4].data),
        Buffer.from("SECRET_AFTER_DEFLATE", "utf8")
      ])
    };

    expect(codes(verifyBuffer(root, buildZip(entries)))).toContain(
      "ZIP_DECOMPRESSION_INVALID"
    );
  });

  it("rejects an archive larger than the bounded raw parser cap", () => {
    const archive = Buffer.alloc(vsixContract.MAX_VSIX_ARCHIVE_BYTES + 1);
    expect(() => vsixContract.parseRawVsix(archive)).toThrow(
      expect.objectContaining({ code: "VSIX_SIZE_INVALID" })
    );
  });

  it("rejects an oversized VSIX file before reading its contents", () => {
    const root = createRepository();
    const archivePath = writeArchive(root, Buffer.alloc(0));
    truncateSync(archivePath, vsixContract.MAX_VSIX_ARCHIVE_BYTES + 1);

    const result = vsixContract.verifyVsix({
      repositoryRoot: root,
      vsixPath: archivePath,
      allowControlledPath: true
    });

    expect(codes(result)).toContain("VSIX_FILE_TOO_LARGE");
  });

  it("keeps failures deterministic, bounded, and free of payload content", () => {
    const root = createRepository();
    const secret = "DO_NOT_PRINT_VSIX_PAYLOAD_SECRET";
    const entries = validEntries(root, { "static/control.html": secret });
    const first = verifyBuffer(root, buildZip(entries));
    const second = verifyBuffer(root, buildZip(entries));
    expect(first.failures).toEqual(second.failures);
    expect(JSON.stringify(first.failures)).not.toContain(secret);
    expect(JSON.stringify(first.failures).length).toBeLessThan(4096);
  });
});

describe("effective packaged metadata and payload bytes", () => {
  it.each([
    ["malformed", "<Types>"],
    ["extra mapping", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension=".exe" ContentType="application/octet-stream"/></Types>`],
    ["wrong JavaScript type", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension=".css" ContentType="text/css"/><Default Extension=".html" ContentType="text/html"/><Default Extension=".js" ContentType="text/plain"/><Default Extension=".txt" ContentType="text/plain"/><Default Extension=".vsixmanifest" ContentType="text/xml"/><Default Extension=".vsomanifest" ContentType="application/json"/></Types>`]
  ])("rejects effective content-types XML %s drift", (_label, xml) => {
    const root = createRepository();
    const result = verifyBuffer(root, buildZip(validEntries(root, {
      "[Content_Types].xml": xml
    })));
    expect(codes(result)).toContain("CONTENT_TYPES_INVALID");
  });

  it.each([
    ["version", validVsixManifest("0.1.24")],
    ["publisher", validVsixManifest().replace('Publisher="ygdb121"', 'Publisher="other"')],
    ["identity", validVsixManifest().replace('Id="roosterjs-description-editor"', 'Id="other"')],
    ["public gallery flag", validVsixManifest().replace("<GalleryFlags/>", "<GalleryFlags>Public</GalleryFlags>")],
    ["target", validVsixManifest().replace("Microsoft.VisualStudio.Services", "Other.Target")],
    ["extra asset", validVsixManifest().replace("</Assets>", '<Asset Type="extra" Path="extra"/></Assets>')],
    ["malformed XML", "<PackageManifest><Metadata>"]
  ])("rejects effective VSIX XML %s drift", (_label, xml) => {
    const root = createRepository();
    const result = verifyBuffer(root, buildZip(validEntries(root, {
      "extension.vsixmanifest": xml
    })));
    expect(codes(result)).toContain("VSIX_MANIFEST_INVALID");
  });

  it.each([
    ["scope", (manifest: Record<string, unknown>) => (manifest.scopes = ["vso.code"])],
    ["extra scope", (manifest: Record<string, unknown>) => (manifest.scopes = ["vso.work_write", "vso.code"])],
    ["manifest version", (manifest: Record<string, unknown>) => (manifest.manifestVersion = 2)],
    ["empty contribution", (manifest: Record<string, unknown>) => (manifest.contributions = [])],
    ["extra contribution type", (manifest: Record<string, unknown>) => (manifest.contributionTypes = [{}])],
    ["unknown field", (manifest: Record<string, unknown>) => (manifest.secret = true)],
    ["wrong input order", (manifest: Record<string, unknown>) => {
      const contribution = (manifest.contributions as Array<Record<string, unknown>>)[0];
      const properties = contribution.properties as Record<string, unknown>;
      (properties.inputs as unknown[]).reverse();
    }]
  ])("rejects effective VSO JSON %s drift", (_label, mutate) => {
    const root = createRepository();
    const manifest = validVsoManifest();
    mutate(manifest);
    const result = verifyBuffer(root, buildZip(validEntries(root, {
      "extension.vsomanifest": `${JSON.stringify(manifest)}\n`
    })));
    expect(codes(result)).toContain("VSO_MANIFEST_INVALID");
  });

  it("rejects malformed or duplicate-key effective VSO JSON", () => {
    const root = createRepository();
    for (const value of ["{", '{"manifestVersion":1,"manifestVersion":1}']) {
      const result = verifyBuffer(root, buildZip(validEntries(root, {
        "extension.vsomanifest": value
      })));
      expect(codes(result)).toContain("VSO_MANIFEST_INVALID");
    }
  });

  it.each([
    "static/control.html",
    "static/control.css",
    "dist/control.js",
    "dist/control.js.LICENSE.txt"
  ])("rejects packaged repository byte drift in %s", name => {
    const root = createRepository();
    const result = verifyBuffer(root, buildZip(validEntries(root, {
      [name]: Buffer.from("changed bytes")
    })));
    expect(codes(result)).toContain("VSIX_PAYLOAD_MISMATCH");
  });

  it.each([
    "static/control.html",
    "static/control.css",
    "dist/control.js",
    "dist/control.js.LICENSE.txt"
  ])("rejects an oversized repository payload before reading %s", name => {
    const root = createRepository();
    const archive = buildZip(validEntries(root));
    truncateSync(join(root, name), vsixContract.MAX_VSIX_ENTRY_BYTES + 1);

    const result = verifyBuffer(root, archive);

    expect(codes(result)).toContain("REPOSITORY_SOURCE_TOO_LARGE");
  });

  it("accepts a matching repository payload at the exact byte cap", () => {
    const root = createRepository();
    writeFileSync(
      join(root, "dist/control.js"),
      Buffer.alloc(vsixContract.MAX_VSIX_ENTRY_BYTES, 0x61)
    );

    const result = verifyBuffer(root, buildZip(validEntries(root)));

    expect(result.failures).toEqual([]);
  });

  it("rejects a symlinked packaged-source directory during standalone verification", () => {
    const root = createRepository();
    const archivePath = writeArchive(root, buildZip(validEntries(root)));
    const staticDirectory = join(root, "static");
    const staticTarget = join(root, "static-real");
    mkdirSync(staticTarget);
    for (const name of ["control.html", "control.css"]) {
      copyFileSync(join(staticDirectory, name), join(staticTarget, name));
    }
    rmSync(staticDirectory, { recursive: true });
    symlinkSync(staticTarget, staticDirectory, "dir");

    const result = vsixContract.verifyVsix({
      repositoryRoot: root,
      vsixPath: archivePath,
      allowControlledPath: true
    });

    expect(codes(result)).toContain("REPOSITORY_SOURCE_INVALID");
  });

  it("rejects a symlinked derived artifacts directory during standalone verification", () => {
    const root = createRepository();
    const artifactTarget = join(root, "artifacts-real");
    mkdirSync(artifactTarget);
    const artifactName = "ygdb121.roosterjs-description-editor-0.1.23.vsix";
    writeFileSync(join(artifactTarget, artifactName), buildZip(validEntries(root)));
    symlinkSync(artifactTarget, join(root, "artifacts"), "dir");

    const result = vsixContract.verifyVsix({
      repositoryRoot: root,
      vsixPath: join(root, "artifacts", artifactName)
    });

    expect(codes(result)).toContain("ARTIFACT_DIRECTORY_INVALID");
  });

  it("rejects an extra VSIX outside artifacts during standalone verification", () => {
    const root = createRepository();
    const archivePath = writeArchive(root, buildZip(validEntries(root)));
    writeFileSync(join(root, "stale-root.vsix"), "stale artifact");

    const result = vsixContract.verifyVsix({
      repositoryRoot: root,
      vsixPath: archivePath,
      allowControlledPath: true
    });

    expect(codes(result)).toContain("REPOSITORY_VSIX_INVALID");
  });
});

describe("local tfx package preflight", () => {
  function prepareStubPackageRoot(): {
    root: string;
    localLog: string;
    globalLog: string;
    pathDirectory: string;
  } {
    const root = createRepository();
    const packageRoot = join(root, "node_modules/tfx-cli");
    mkdirSync(join(packageRoot, "_build"), { recursive: true });
    writeFileSync(join(packageRoot, "package.json"), `${JSON.stringify({
      name: "tfx-cli",
      version: "0.23.1",
      bin: { tfx: "./_build/tfx-cli.js" }
    }, null, 2)}\n`);
    writeFileSync(join(packageRoot, "_build/tfx-cli.js"), `
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
fs.writeFileSync(process.env.LOCAL_TFX_LOG, JSON.stringify(args));
const outputIndex = args.indexOf("--output-path");
const outputPath = args[outputIndex + 1];
if (process.env.LOCAL_TFX_WRITE_THEN_FAIL === "1") {
  fs.writeFileSync(outputPath, "partial controlled stub archive");
  fs.writeFileSync(path.join(path.dirname(outputPath), "retain.txt"), "retain");
  process.exit(17);
}
if (process.env.LOCAL_TFX_FORCE_FAILURE === "1") {
  process.exit(17);
}
fs.copyFileSync(path.join(process.cwd(), "controlled-archive.bin"), outputPath);
if (process.env.LOCAL_TFX_EXTRA_OUTPUT === "1") {
  fs.writeFileSync(path.join(path.dirname(outputPath), "retain.txt"), "retain");
}
`);
    writeFileSync(join(root, "controlled-archive.bin"), buildZip(validEntries(root)));
    const pathDirectory = join(root, "fake-global-bin");
    mkdirSync(pathDirectory);
    const globalLog = join(root, "global-tfx-called");
    writeFileSync(join(pathDirectory, "tfx"), `#!/bin/sh\ntouch '${globalLog}'\nexit 99\n`);
    chmodSync(join(pathDirectory, "tfx"), 0o755);
    return { root, localLog: join(root, "local-tfx-args.json"), globalLog, pathDirectory };
  }

  it("invokes only the lock-resolved local tfx entry and transactionally verifies its archive", () => {
    const fixture = prepareStubPackageRoot();
    const result = spawnSync(
      process.execPath,
      [resolve("scripts/package-vsix.mjs"), "--repository-root", fixture.root],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          LOCAL_TFX_LOG: fixture.localLog,
          PATH: `${fixture.pathDirectory}:${process.env.PATH ?? ""}`
        }
      }
    );

    const artifact = join(
      fixture.root,
      "artifacts/ygdb121.roosterjs-description-editor-0.1.23.vsix"
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("VSIX package created.\n");
    expect(existsSync(fixture.globalLog)).toBe(false);
    expect(readdirSync(join(fixture.root, "artifacts"))).toEqual([
      "ygdb121.roosterjs-description-editor-0.1.23.vsix"
    ]);
    expect(readFileSync(fixture.localLog, "utf8")).toBe(JSON.stringify([
      "extension",
      "create",
      "--root",
      fixture.root,
      "--manifest-globs",
      "vss-extension.json",
      "--output-path",
      artifact
    ]));
  });

  it("removes the canonical artifact when local tfx emits a malformed archive", () => {
    const fixture = prepareStubPackageRoot();
    writeFileSync(join(fixture.root, "controlled-archive.bin"), "not a ZIP archive");

    const result = spawnSync(
      process.execPath,
      [resolve("scripts/package-vsix.mjs"), "--repository-root", fixture.root],
      { encoding: "utf8", env: { ...process.env, LOCAL_TFX_LOG: fixture.localLog } }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toBe(
      "VSIX_PACKAGE_FAILED\nZIP_TRUNCATED: VSIX ZIP structure is truncated.\n"
    );
    expect(readdirSync(join(fixture.root, "artifacts"))).toEqual([]);
  });

  it("removes the canonical artifact when packaged source bytes do not match", () => {
    const fixture = prepareStubPackageRoot();
    writeFileSync(
      join(fixture.root, "controlled-archive.bin"),
      buildZip(validEntries(fixture.root, { "static/control.css": ".mismatch {}\n" }))
    );

    const result = spawnSync(
      process.execPath,
      [resolve("scripts/package-vsix.mjs"), "--repository-root", fixture.root],
      { encoding: "utf8", env: { ...process.env, LOCAL_TFX_LOG: fixture.localLog } }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toBe(
      "VSIX_PACKAGE_FAILED\nVSIX_PAYLOAD_MISMATCH: A packaged repository payload differs from source bytes.\n"
    );
    expect(readdirSync(join(fixture.root, "artifacts"))).toEqual([]);
  });

  it("removes only the canonical artifact when local tfx emits an extra output", () => {
    const fixture = prepareStubPackageRoot();

    const result = spawnSync(
      process.execPath,
      [resolve("scripts/package-vsix.mjs"), "--repository-root", fixture.root],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          LOCAL_TFX_EXTRA_OUTPUT: "1",
          LOCAL_TFX_LOG: fixture.localLog
        }
      }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toBe(
      "VSIX_PACKAGE_FAILED\nARTIFACT_OUTPUT_INVALID: Packaging must leave exactly one expected VSIX artifact.\n"
    );
    expect(readdirSync(join(fixture.root, "artifacts"))).toEqual(["retain.txt"]);
  });

  it("reports the bounded local-tfx diagnostic when the subprocess fails", () => {
    const fixture = prepareStubPackageRoot();
    const result = spawnSync(
      process.execPath,
      [resolve("scripts/package-vsix.mjs"), "--repository-root", fixture.root],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          LOCAL_TFX_FORCE_FAILURE: "1",
          LOCAL_TFX_LOG: fixture.localLog
        }
      }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toBe(
      "VSIX_PACKAGE_FAILED\nLOCAL_TFX_FAILED: Local tfx packaging failed.\n"
    );
  });

  it("removes only the derived artifact when local tfx writes and then fails", () => {
    const fixture = prepareStubPackageRoot();
    const result = spawnSync(
      process.execPath,
      [resolve("scripts/package-vsix.mjs"), "--repository-root", fixture.root],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          LOCAL_TFX_WRITE_THEN_FAIL: "1",
          LOCAL_TFX_LOG: fixture.localLog
        }
      }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toBe(
      "VSIX_PACKAGE_FAILED\nLOCAL_TFX_FAILED: Local tfx packaging failed.\n"
    );
    expect(readdirSync(join(fixture.root, "artifacts"))).toEqual(["retain.txt"]);
  });

  it("rejects oversized local tfx metadata before invocation", () => {
    const fixture = prepareStubPackageRoot();
    truncateSync(
      join(fixture.root, "node_modules/tfx-cli/package.json"),
      vsixContract.MAX_VSIX_ENTRY_BYTES + 1
    );

    const result = spawnSync(
      process.execPath,
      [resolve("scripts/package-vsix.mjs"), "--repository-root", fixture.root],
      { encoding: "utf8", env: { ...process.env, LOCAL_TFX_LOG: fixture.localLog } }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("LOCAL_TFX_TOO_LARGE");
    expect(existsSync(fixture.localLog)).toBe(false);
  });

  it("accepts local tfx metadata at the exact byte cap", () => {
    const fixture = prepareStubPackageRoot();
    writeJsonAtExactSize(
      join(fixture.root, "node_modules/tfx-cli/package.json"),
      { name: "tfx-cli", version: "0.23.1", bin: { tfx: "./_build/tfx-cli.js" } },
      vsixContract.MAX_VSIX_ENTRY_BYTES
    );

    const result = spawnSync(
      process.execPath,
      [resolve("scripts/package-vsix.mjs"), "--repository-root", fixture.root],
      { encoding: "utf8", env: { ...process.env, LOCAL_TFX_LOG: fixture.localLog } }
    );

    expect(result.status).toBe(0);
    expect(existsSync(fixture.localLog)).toBe(true);
  });

  it("rejects an oversized source payload before invoking local tfx", () => {
    const fixture = prepareStubPackageRoot();
    truncateSync(
      join(fixture.root, "static/control.html"),
      vsixContract.MAX_VSIX_ENTRY_BYTES + 1
    );

    const result = spawnSync(
      process.execPath,
      [resolve("scripts/package-vsix.mjs"), "--repository-root", fixture.root],
      { encoding: "utf8", env: { ...process.env, LOCAL_TFX_LOG: fixture.localLog } }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("REPOSITORY_SOURCE_TOO_LARGE");
    expect(existsSync(fixture.localLog)).toBe(false);
  });

  it.each([
    ["installed version", (root: string) => {
      const path = join(root, "node_modules/tfx-cli/package.json");
      const value = JSON.parse(readFileSync(path, "utf8"));
      value.version = "0.22.0";
      writeFileSync(path, JSON.stringify(value));
    }],
    ["bin path escape", (root: string) => {
      const path = join(root, "node_modules/tfx-cli/package.json");
      const value = JSON.parse(readFileSync(path, "utf8"));
      value.bin.tfx = "../outside.js";
      writeFileSync(path, JSON.stringify(value));
    }],
    ["bin symlink", (root: string) => {
      const bin = join(root, "node_modules/tfx-cli/_build/tfx-cli.js");
      const target = join(root, "outside.js");
      writeFileSync(target, "");
      rmSync(bin);
      symlinkSync(target, bin);
    }]
  ])("rejects local tfx %s drift before invocation", (_label, mutate) => {
    const fixture = prepareStubPackageRoot();
    mutate(fixture.root);
    const result = spawnSync(
      process.execPath,
      [resolve("scripts/package-vsix.mjs"), "--repository-root", fixture.root],
      { encoding: "utf8", env: { ...process.env, LOCAL_TFX_LOG: fixture.localLog } }
    );
    expect(result.status).toBe(1);
    expect(existsSync(fixture.localLog)).toBe(false);
    expect(result.stderr).not.toContain(fixture.root);
  });

  it.each([
    ["static extra", (root: string) => writeFileSync(join(root, "static/.DS_Store"), "junk")],
    ["dist nested", (root: string) => {
      mkdirSync(join(root, "dist/nested"));
      writeFileSync(join(root, "dist/nested/file"), "junk");
    }],
    ["source symlink", (root: string) => {
      const path = join(root, "static/control.css");
      const target = join(root, "control.real.css");
      copyFileSync(path, target);
      rmSync(path);
      symlinkSync(target, path);
    }],
    ["artifact extra", (root: string) => {
      mkdirSync(join(root, "artifacts"));
      writeFileSync(join(root, "artifacts/old.vsix"), "junk");
    }],
    ["root VSIX residue", (root: string) => {
      writeFileSync(join(root, "stale-root.vsix"), "junk");
    }],
    ["nested VSIX residue", (root: string) => {
      mkdirSync(join(root, "docs"));
      writeFileSync(join(root, "docs/stale-nested.vsix"), "junk");
    }],
    ["static directory symlink", (root: string) => {
      const staticDirectory = join(root, "static");
      const target = join(root, "static-real");
      mkdirSync(target);
      for (const name of ["control.html", "control.css"]) {
        copyFileSync(join(staticDirectory, name), join(target, name));
      }
      rmSync(staticDirectory, { recursive: true });
      symlinkSync(target, staticDirectory, "dir");
    }],
    ["artifact directory symlink", (root: string) => {
      const target = join(root, "artifact-real");
      mkdirSync(target);
      symlinkSync(target, join(root, "artifacts"), "dir");
    }]
  ])("rejects %s during source/artifact preflight", (_label, mutate) => {
    const fixture = prepareStubPackageRoot();
    mutate(fixture.root);
    const result = spawnSync(
      process.execPath,
      [resolve("scripts/package-vsix.mjs"), "--repository-root", fixture.root],
      { encoding: "utf8", env: { ...process.env, LOCAL_TFX_LOG: fixture.localLog } }
    );
    expect(result.status).toBe(1);
    expect(existsSync(fixture.localLog)).toBe(false);
  });

  it("keeps root and nested VSIX residue visible to the CI untracked-file gate", () => {
    const root = mkdtempSync(join(tmpdir(), "rooster-vsix-ignore-"));
    temporaryRoots.push(root);
    copyFileSync(resolve(".gitignore"), join(root, ".gitignore"));
    const init = spawnSync(
      "git",
      ["-c", "init.defaultBranch=main", "init", "--quiet"],
      { cwd: root, encoding: "utf8" }
    );
    expect(init.status).toBe(0);

    const ignored = spawnSync(
      "git",
      [
        "-c",
        "core.excludesFile=/dev/null",
        "check-ignore",
        "--no-index",
        "--stdin"
      ],
      {
        cwd: root,
        encoding: "utf8",
        input: "root-extra.vsix\nnested/root-extra.vsix\n"
      }
    );

    expect(ignored.status).toBe(1);
    expect(ignored.stdout).toBe("");
  });

  it("keeps unexpected filesystem failures bounded and path-free", () => {
    const fixture = prepareStubPackageRoot();
    const artifacts = join(fixture.root, "artifacts");
    mkdirSync(artifacts);
    chmodSync(artifacts, 0);
    try {
      const result = spawnSync(
        process.execPath,
        [resolve("scripts/package-vsix.mjs"), "--repository-root", fixture.root],
        { encoding: "utf8", env: { ...process.env, LOCAL_TFX_LOG: fixture.localLog } }
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("VSIX_PACKAGE_INVALID");
      expect(result.stderr).not.toContain(fixture.root);
      expect(result.stderr.length).toBeLessThan(1024);
      expect(existsSync(fixture.localLog)).toBe(false);
    } finally {
      chmodSync(artifacts, 0o700);
    }
  });
});
