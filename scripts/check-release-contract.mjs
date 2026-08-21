import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatReleaseFailures,
  readReleaseContract
} from "./lib/release-contract.mjs";

const defaultRepositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseRepositoryRoot(argumentsList) {
  if (argumentsList.length === 0) {
    return defaultRepositoryRoot;
  }
  if (
    argumentsList.length === 2 &&
    argumentsList[0] === "--repository-root" &&
    typeof argumentsList[1] === "string" &&
    argumentsList[1].length > 0
  ) {
    return resolve(argumentsList[1]);
  }
  return null;
}
const repositoryRoot = parseRepositoryRoot(process.argv.slice(2));
if (!repositoryRoot) {
  process.exitCode = 1;
  console.error("RELEASE_CONTRACT_FAILED");
  console.error("INVALID_ARGUMENTS: Release checker arguments are invalid.");
} else {
  const result = readReleaseContract(repositoryRoot);
  if (result.failures.length > 0) {
    process.exitCode = 1;
    console.error("RELEASE_CONTRACT_FAILED");
    for (const line of formatReleaseFailures(result.failures)) {
      console.error(line);
    }
  } else {
    console.log("Release contract verified.");
  }
}
