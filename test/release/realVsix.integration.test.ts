import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

interface VsixContractModule {
  verifyVsix(options: {
    readonly repositoryRoot: string;
    readonly vsixPath: string;
    readonly allowControlledPath: true;
  }): {
    readonly failures: readonly { readonly code: string; readonly message: string }[];
    readonly report: null | {
      readonly entries: readonly string[];
      readonly version: string;
      readonly publisher: string;
      readonly extensionId: string;
      readonly scopes: readonly string[];
    };
  };
}

const repositoryRoot = process.cwd();
const vsixContract = await import(
  pathToFileURL(resolve("scripts/lib/vsix-contract.mjs")).href
) as unknown as VsixContractModule;
const temporaryRoot = mkdtempSync(join(tmpdir(), "rooster-real-tfx-vsix-"));

afterAll(() => {
  rmSync(temporaryRoot, { recursive: true, force: true });
});

describe("real pinned tfx VSIX integration", () => {
  it("routes the real local tfx 0.23.1 archive through the same verifier", () => {
    mkdirSync(join(temporaryRoot, "static"));
    mkdirSync(join(temporaryRoot, "dist"));
    for (const path of ["vss-extension.json", "package.json", "package-lock.json"]) {
      copyFileSync(resolve(path), join(temporaryRoot, path));
    }
    writeFileSync(join(temporaryRoot, "static/control.html"), "<!doctype html><html><body></body></html>\n");
    writeFileSync(join(temporaryRoot, "static/control.css"), ".rdx-app {}\n");
    writeFileSync(join(temporaryRoot, "dist/control.js"), "(() => {})();\n");
    writeFileSync(join(temporaryRoot, "dist/control.js.LICENSE.txt"), "controlled license\n");

    const localTfxPackage = JSON.parse(
      readFileSync(resolve("node_modules/tfx-cli/package.json"), "utf8")
    );
    expect(localTfxPackage.version).toBe("0.23.1");
    expect(localTfxPackage.bin).toEqual({ tfx: "./_build/tfx-cli.js" });

    const archivePath = join(temporaryRoot, "real-tfx.vsix");
    const packageResult = spawnSync(
      process.execPath,
      [
        resolve("node_modules/tfx-cli/_build/tfx-cli.js"),
        "extension",
        "create",
        "--root",
        temporaryRoot,
        "--manifest-globs",
        "vss-extension.json",
        "--output-path",
        archivePath
      ],
      { encoding: "utf8" }
    );
    expect(packageResult.status).toBe(0);

    const verification = vsixContract.verifyVsix({
      repositoryRoot: temporaryRoot,
      vsixPath: archivePath,
      allowControlledPath: true
    });

    expect(verification.failures).toEqual([]);
    expect(verification.report).toMatchObject({
      entries: [
        "[Content_Types].xml",
        "dist/",
        "dist/control.js",
        "dist/control.js.LICENSE.txt",
        "extension.vsixmanifest",
        "extension.vsomanifest",
        "static/",
        "static/control.css",
        "static/control.html"
      ],
      version: "0.1.25",
      publisher: "ygdb121",
      extensionId: "roosterjs-description-editor",
      scopes: ["vso.work_write"]
    });
  });
});
