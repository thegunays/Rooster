import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatVsixFailure,
  verifyVsix
} from "./lib/vsix-contract.mjs";
import { readReleaseContract } from "./lib/release-contract.mjs";

const defaultRepositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argumentsList = process.argv.slice(2);
let repositoryRoot = defaultRepositoryRoot;
let vsixPath = null;
let allowControlledPath = false;

if (argumentsList.length === 0) {
  const release = readReleaseContract(repositoryRoot);
  if (release.failures.length === 0 && release.contract?.artifactFileName) {
    vsixPath = resolve(repositoryRoot, "artifacts", release.contract.artifactFileName);
  }
} else if (
  argumentsList.length === 4 &&
  argumentsList[0] === "--repository-root" &&
  argumentsList[2] === "--vsix"
) {
  repositoryRoot = resolve(argumentsList[1]);
  vsixPath = resolve(argumentsList[3]);
  allowControlledPath = true;
}

if (!vsixPath) {
  process.exitCode = 1;
  console.error("VSIX_VERIFICATION_FAILED");
  console.error("INVALID_ARGUMENTS: VSIX verifier arguments are invalid.");
} else {
  const result = verifyVsix({ repositoryRoot, vsixPath, allowControlledPath });
  if (result.failures.length > 0) {
    process.exitCode = 1;
    console.error("VSIX_VERIFICATION_FAILED");
    for (const failure of result.failures) {
      console.error(formatVsixFailure(failure));
    }
  } else {
    const report = result.report;
    console.log("VSIX verification passed.");
    console.log(`Artifact: ${resolve(vsixPath).split(/[\\/]/).pop()}`);
    console.log(`SHA-256: ${report.sha256}`);
    console.log(`Bytes: ${report.byteSize}`);
    console.log(`Identity: ${report.publisher}.${report.extensionId}`);
    console.log(`Version: ${report.version}`);
    console.log(`Scopes: ${report.scopes.join(",")}`);
    console.log("Entries:");
    for (const entry of report.entries) {
      console.log(`- ${entry}`);
    }
  }
}
