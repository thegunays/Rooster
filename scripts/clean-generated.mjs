import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { cleanGeneratedDirectories } from "./lib/build-contract.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

cleanGeneratedDirectories(repositoryRoot);
