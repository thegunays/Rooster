import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { assertBuildOutputs } from "./lib/build-contract.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2];

try {
  assertBuildOutputs(repositoryRoot, mode);
} catch (error) {
  process.exitCode = 1;
  console.error(error instanceof Error ? error.message : error);
}
