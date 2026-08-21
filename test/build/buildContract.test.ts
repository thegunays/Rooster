import { afterEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

type BuildContract = {
  cleanGeneratedDirectories(repositoryRoot: string): void;
  resolveGeneratedTarget(repositoryRoot: string, target: string): string;
  assertBuildOutputs(repositoryRoot: string, mode: "production" | "harness"): void;
};

const temporaryRoots: string[] = [];

async function loadBuildContract(): Promise<BuildContract> {
  const moduleUrl = pathToFileURL(
    join(process.cwd(), "scripts/lib/build-contract.mjs")
  ).href;

  return import(moduleUrl) as Promise<BuildContract>;
}

function createRepository(): string {
  const repositoryRoot = mkdtempSync(join(tmpdir(), "rooster-build-contract-"));
  temporaryRoots.push(repositoryRoot);
  return repositoryRoot;
}

function writeDistFile(repositoryRoot: string, file: string): void {
  const filePath = join(repositoryRoot, "dist", file);
  mkdirSync(join(filePath, ".."), { recursive: true });
  writeFileSync(filePath, "output");
}

afterEach(() => {
  while (temporaryRoots.length > 0) {
    rmSync(temporaryRoots.pop()!, { recursive: true, force: true });
  }
});

describe("build contract", () => {
  it("removes only the repository dist and artifacts directories", async () => {
    const contract = await loadBuildContract();
    const repositoryRoot = createRepository();
    const sibling = join(repositoryRoot, "keep-me");

    mkdirSync(join(repositoryRoot, "dist"), { recursive: true });
    mkdirSync(join(repositoryRoot, "artifacts"), { recursive: true });
    mkdirSync(sibling, { recursive: true });

    contract.cleanGeneratedDirectories(repositoryRoot);

    expect(existsSync(join(repositoryRoot, "dist"))).toBe(false);
    expect(existsSync(join(repositoryRoot, "artifacts"))).toBe(false);
    expect(existsSync(sibling)).toBe(true);
  });

  it("rejects generated targets outside the supplied repository root", async () => {
    const contract = await loadBuildContract();
    const repositoryRoot = createRepository();
    const outsideTarget = join(repositoryRoot, "..", "outside");

    expect(() => contract.resolveGeneratedTarget(repositoryRoot, outsideTarget)).toThrow(
      "outside repository root"
    );
  });

  it("rejects generated targets other than dist and artifacts", async () => {
    const contract = await loadBuildContract();
    const repositoryRoot = createRepository();

    expect(() => contract.resolveGeneratedTarget(repositoryRoot, join(repositoryRoot, "keep-me"))).toThrow(
      "not an allowed generated directory"
    );
  });

  it("refuses to clean a generated directory that is a symlink", async () => {
    const contract = await loadBuildContract();
    const repositoryRoot = createRepository();
    const externalDirectory = mkdtempSync(join(tmpdir(), "rooster-external-"));
    temporaryRoots.push(externalDirectory);

    symlinkSync(externalDirectory, join(repositoryRoot, "dist"), "dir");

    expect(() => contract.cleanGeneratedDirectories(repositoryRoot)).toThrow("symlink");
    expect(existsSync(externalDirectory)).toBe(true);
  });

  it("accepts exactly the production output listing", async () => {
    const contract = await loadBuildContract();
    const repositoryRoot = createRepository();

    writeDistFile(repositoryRoot, "control.js");
    writeDistFile(repositoryRoot, "control.js.LICENSE.txt");

    expect(() => contract.assertBuildOutputs(repositoryRoot, "production")).not.toThrow();
  });

  it("accepts exactly the harness output listing", async () => {
    const contract = await loadBuildContract();
    const repositoryRoot = createRepository();

    writeDistFile(repositoryRoot, "control.js");
    writeDistFile(repositoryRoot, "test-harness.js");

    expect(() => contract.assertBuildOutputs(repositoryRoot, "harness")).not.toThrow();
  });

  it("rejects a symlink that imitates an expected output file", async () => {
    const contract = await loadBuildContract();
    const repositoryRoot = createRepository();
    const externalDirectory = mkdtempSync(join(tmpdir(), "rooster-external-"));
    temporaryRoots.push(externalDirectory);

    writeFileSync(join(externalDirectory, "control.js"), "external output");
    mkdirSync(join(repositoryRoot, "dist"), { recursive: true });
    symlinkSync(
      join(externalDirectory, "control.js"),
      join(repositoryRoot, "dist", "control.js"),
      "file"
    );
    writeDistFile(repositoryRoot, "control.js.LICENSE.txt");

    expect(() => contract.assertBuildOutputs(repositoryRoot, "production")).toThrow(
      "Unexpected build outputs"
    );
  });

  it.each([
    ["production", ["control.js"]],
    ["harness", ["control.js"]],
    ["production", ["control.js", "control.js.LICENSE.txt", "extra.js"]],
    ["harness", ["control.js", "test-harness.js", "nested/extra.js"]]
  ] as const)("rejects an incomplete or unexpected %s output listing", async (mode, files) => {
    const contract = await loadBuildContract();
    const repositoryRoot = createRepository();

    for (const file of files) {
      writeDistFile(repositoryRoot, file);
    }

    expect(() => contract.assertBuildOutputs(repositoryRoot, mode)).toThrow(
      "Unexpected build outputs"
    );
  });
});
