import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { syncReleaseVersion } from "./lib/release-contract.mjs";

const defaultRepositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argumentsList = process.argv.slice(2);
const repositoryRoot = argumentsList.length === 0
  ? defaultRepositoryRoot
  : argumentsList.length === 2 && argumentsList[0] === "--repository-root"
    ? resolve(argumentsList[1])
    : null;

if (!repositoryRoot) {
  process.exitCode = 1;
  console.error("RELEASE_SYNC_FAILED");
  console.error("INVALID_ARGUMENTS: Release synchronization arguments are invalid.");
} else {
  try {
    const result = syncReleaseVersion(repositoryRoot);
    console.log(
      result.changed
        ? `Release mirrors synchronized to ${result.version}.`
        : `Release mirrors already synchronized to ${result.version}.`
    );
  } catch {
    process.exitCode = 1;
    console.error("RELEASE_SYNC_FAILED");
    console.error("RELEASE_SYNC_BLOCKED: Release synchronization blocked.");
  }
}
