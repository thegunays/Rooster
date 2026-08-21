import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  inspectEvidencePath,
  validateRegressionEvidence
} from "./lib/regression-evidence.mjs";

function printFatal(code, message) {
  console.error(`FAIL [${code}] evidence: ${message}`);
  process.exitCode = 1;
}

const argumentsWithoutNode = process.argv.slice(2);
const requireAzureHost = argumentsWithoutNode.includes("--require-azure-host");
const evidenceArguments = argumentsWithoutNode.filter(argument => argument !== "--require-azure-host");
const unknownOptions = evidenceArguments.filter(argument => argument.startsWith("-"));

if (evidenceArguments.length !== 1 || unknownOptions.length > 0) {
  printFatal(
    "USAGE_INVALID",
    "Usage: node scripts/verify-regression-evidence.mjs [--require-azure-host] <evidence.json>"
  );
} else {
  const evidencePath = resolve(evidenceArguments[0]);
  const pathInspection = inspectEvidencePath(evidencePath);
  if (pathInspection.status === "missing") {
    printFatal("EVIDENCE_FILE_MISSING", "Evidence JSON file is missing.");
  } else if (pathInspection.status === "unreadable") {
    printFatal("EVIDENCE_FILE_UNREADABLE", "Evidence JSON file is unreadable.");
  } else if (pathInspection.status === "symlink") {
    printFatal("EVIDENCE_SYMLINK_FORBIDDEN", "Evidence JSON path must not contain symlinks.");
  } else if (pathInspection.status === "not-regular") {
    printFatal("EVIDENCE_FILE_NOT_REGULAR", "Evidence JSON target must be a regular file.");
  } else {
    let evidenceText;
    try {
      evidenceText = readFileSync(pathInspection.path, "utf8");
    } catch {
      printFatal("EVIDENCE_FILE_UNREADABLE", "Evidence JSON file is unreadable.");
    }

    let evidence;
    if (evidenceText !== undefined) {
      try {
        evidence = JSON.parse(evidenceText);
      } catch {
        printFatal("EVIDENCE_JSON_INVALID", "Evidence JSON could not be parsed.");
      }
    }

    if (evidence !== undefined) {
      if (evidence && evidence.evidenceKind === "local-dry-run") {
        console.log("=== LOCAL DRY RUN ONLY - NOT AZURE-HOST EVIDENCE ===");
      } else if (evidence && evidence.evidenceKind === "azure-host") {
        console.log("=== AZURE-HOST EVIDENCE ===");
      } else {
        console.log("=== UNCLASSIFIED REGRESSION EVIDENCE ===");
      }

      const failures = validateRegressionEvidence(evidence, {
        evidenceDirectory: dirname(pathInspection.path),
        requireAzureHost
      });
      if (failures.length === 0) {
        console.log(`PASS: ${evidence.scenario} regression evidence satisfies the selected gate.`);
      } else {
        failures.forEach((failure, index) => {
          console.error(
            `FAIL ${index + 1}/${failures.length} [${failure.code}] ${failure.field}: ${failure.message}`
          );
        });
        process.exitCode = 1;
      }
    }
  }
}
