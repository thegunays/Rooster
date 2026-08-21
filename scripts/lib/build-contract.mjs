import { lstatSync, readdirSync, rmSync } from "node:fs";
import { resolve, sep } from "node:path";

const generatedDirectoryNames = new Set(["dist", "artifacts"]);

function isChildPath(repositoryRoot, target) {
  return target.startsWith(`${repositoryRoot}${sep}`);
}

export function resolveGeneratedTarget(repositoryRoot, target) {
  const resolvedRepositoryRoot = resolve(repositoryRoot);
  const resolvedTarget = resolve(target);

  if (!isChildPath(resolvedRepositoryRoot, resolvedTarget)) {
    throw new Error(`Generated target is outside repository root: ${resolvedTarget}`);
  }

  const relativeTarget = resolvedTarget.slice(resolvedRepositoryRoot.length + 1);
  if (!generatedDirectoryNames.has(relativeTarget)) {
    throw new Error(`Generated target is not an allowed generated directory: ${resolvedTarget}`);
  }

  try {
    if (lstatSync(resolvedTarget).isSymbolicLink()) {
      throw new Error(`Generated target is a symlink: ${resolvedTarget}`);
    }
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return resolvedTarget;
    }
    throw error;
  }

  return resolvedTarget;
}

export function cleanGeneratedDirectories(repositoryRoot) {
  const resolvedRepositoryRoot = resolve(repositoryRoot);
  const targets = ["dist", "artifacts"].map(name =>
    resolveGeneratedTarget(resolvedRepositoryRoot, resolve(resolvedRepositoryRoot, name))
  );

  for (const target of targets) {
    rmSync(target, { recursive: true, force: true });
  }
}

function listDistFiles(repositoryRoot) {
  const distDirectory = resolveGeneratedTarget(repositoryRoot, resolve(repositoryRoot, "dist"));
  const files = [];

  function visit(directory, relativeDirectory = "") {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") {
        return;
      }
      throw error;
    }

    for (const entry of entries) {
      const relativePath = `${relativeDirectory}${entry.name}`;
      if (entry.isDirectory()) {
        files.push(`${relativePath}/`);
        visit(resolve(directory, entry.name), `${relativePath}/`);
      } else if (entry.isSymbolicLink()) {
        files.push(`${relativePath}@`);
      } else {
        files.push(relativePath);
      }
    }
  }

  visit(distDirectory);
  return files.sort();
}

export function assertBuildOutputs(repositoryRoot, mode) {
  const expected = mode === "production"
    ? ["control.js", "control.js.LICENSE.txt"]
    : mode === "harness"
      ? ["control.js", "test-harness.js"]
      : null;
  const actual = listDistFiles(repositoryRoot);

  if (!expected || JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Unexpected build outputs ${JSON.stringify({ mode, expected: expected ?? [], actual })}`
    );
  }
}
