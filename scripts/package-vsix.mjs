import { spawnSync } from "node:child_process";
import { unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatVsixFailure,
  preflightPackage,
  validatePackagedArtifact,
  verifyVsix
} from "./lib/vsix-contract.mjs";

const defaultRepositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argumentsList = process.argv.slice(2);
const repositoryRoot = argumentsList.length === 0
  ? defaultRepositoryRoot
  : argumentsList.length === 2 && argumentsList[0] === "--repository-root"
    ? resolve(argumentsList[1])
    : null;

if (!repositoryRoot) {
  process.exitCode = 1;
  console.error("VSIX_PACKAGE_FAILED");
  console.error("INVALID_ARGUMENTS: VSIX package arguments are invalid.");
} else {
  let plan = null;
  try {
    plan = preflightPackage(repositoryRoot);
    const result = spawnSync(process.execPath, plan.arguments, {
      cwd: plan.repositoryRoot,
      env: process.env,
      encoding: "utf8",
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    if (result.error || result.signal || result.status !== 0) {
      throw Object.assign(new Error("Local tfx packaging failed."), {
        code: "LOCAL_TFX_FAILED"
      });
    }
    validatePackagedArtifact(plan);
    const verification = verifyVsix({
      repositoryRoot: plan.repositoryRoot,
      vsixPath: plan.artifactPath
    });
    if (verification.failures.length > 0) {
      const failure = verification.failures[0];
      throw Object.assign(new Error(failure.message), {
        name: "VsixContractError",
        code: failure.code
      });
    }
    console.log("VSIX package created.");
  } catch (error) {
    process.exitCode = 1;
    console.error("VSIX_PACKAGE_FAILED");
    const isContractFailure = error &&
      typeof error === "object" &&
      error.name === "VsixContractError" &&
      typeof error.code === "string" &&
      typeof error.message === "string";
    const isLocalTfxFailure = error instanceof Error &&
      error.code === "LOCAL_TFX_FAILED" &&
      error.message === "Local tfx packaging failed.";
    if (plan?.artifactPath) {
      try {
        unlinkSync(plan.artifactPath);
      } catch {
        // Preserve the original bounded downstream diagnostic.
      }
    }
    const failure = isContractFailure || isLocalTfxFailure
      ? { code: error.code, message: error.message || "VSIX packaging failed." }
      : { code: "VSIX_PACKAGE_INVALID", message: "VSIX packaging failed." };
    console.error(formatVsixFailure(failure));
  }
}
