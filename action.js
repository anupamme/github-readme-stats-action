import { exec } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { getInput, info, setOutput, warning } from "@actions/core";

const execAsync = promisify(exec);
const CORE_PACKAGE_NAME = "@stats-organization/github-readme-stats-core";

const validateCoreVersion = (value) => {
  const pattern = /^[a-zA-Z0-9._-]*$/;
  if (!pattern.test(value)) {
    throw new Error("core_version must contain only a-zA-Z0-9._- characters.");
  }
  return value;
};

/**
 * Resolve the `path` input relative to the workspace, constraining it to the
 * workspace directory. This isn't a security isolation boundary (a workflow
 * author already controls this input and the runner) — it exists so the
 * documented "relative to the workspace" output contract holds even if a
 * caller accidentally passes `../` or an absolute path.
 * @param {string} baseDir Workspace root (normally `process.cwd()`).
 * @param {string} inputPath Value of the `path` input.
 * @returns {string} Resolved, workspace-confined output path.
 */
export const resolveWorkspacePath = (baseDir, inputPath) => {
  const resolved = path.resolve(baseDir, inputPath);
  if (resolved !== baseDir && !resolved.startsWith(baseDir + path.sep)) {
    throw new Error("path must resolve within the workspace directory.");
  }
  return resolved;
};

/**
 * Install the requested core package into an isolated temporary directory.
 * @param {string} version Package version.
 * @returns {Promise<string>} Directory containing the installed package.
 */
const installCorePackage = async (version) => {
  const installDir = await mkdtemp(path.join(os.tmpdir(), "grs-core-"));
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const packageSpec = `${CORE_PACKAGE_NAME}@${version}`;

  try {
    await writeFile(
      path.join(installDir, "package.json"),
      JSON.stringify({ private: true, type: "module" }),
      "utf8",
    );

    await execAsync(
      `${npmCommand} install --no-save --ignore-scripts --no-package-lock ${packageSpec}`,
      {
        cwd: installDir,
        env: process.env,
      },
    );

    return installDir;
  } catch (error) {
    throw new Error(
      `Failed to install ${CORE_PACKAGE_NAME}@${version}: ${error}`,
    );
  }
};

/**
 * Load the core package either from the bundled dependency or from an isolated install.
 * @param {string} version Package version.
 * @returns {Promise<Record<string, unknown>>} Loaded module and cleanup callback.
 */
const loadCoreModule = async (version) => {
  if (!version) {
    return await import(CORE_PACKAGE_NAME);
  }

  const installDir = await installCorePackage(version);
  const installRequire = createRequire(path.join(installDir, "package.json"));
  const modulePath = installRequire.resolve(CORE_PACKAGE_NAME);
  return await import(pathToFileURL(modulePath).href);
};

/**
 * Map of supported card types to the core export to call and the option each requires.
 * @type {Record<string, { exportName: string, requires: string }>}
 */
const CARDS = {
  stats: { exportName: "api", requires: "username" },
  "top-langs": { exportName: "topLangs", requires: "username" },
  pin: { exportName: "pin", requires: "repo" },
  wakatime: { exportName: "wakatime", requires: "username" },
  gist: { exportName: "gist", requires: "id" },
};

/**
 * Parse options from query string or JSON and normalize values to strings.
 * @param {string} value Input value.
 * @returns {Record<string, string>} Parsed options.
 */
export const parseOptions = (value) => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return {};
  }

  if (trimmed.startsWith("{")) {
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error("Invalid JSON in options.");
    }
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([, val]) => val !== null && val !== undefined)
        .map(([key, val]) => [
          key,
          Array.isArray(val) ? val.join(",") : String(val),
        ]),
    );
  }

  const params = new URLSearchParams(trimmed);
  return Object.fromEntries(
    [...new Set(params.keys())].map((key) => [
      key,
      params.getAll(key).join(","),
    ]),
  );
};

/**
 * Generate the requested card and write it to disk.
 */
export const run = async () => {
  const card = getInput("card", { required: true }).toLowerCase();
  const optionsInput = getInput("options");
  const outputPathInput = getInput("path");
  const coreVersion = validateCoreVersion(getInput("core_version"));
  const failOnError = /^(true|1|yes)$/i.test(getInput("fail_on_error"));

  const cardDef = CARDS[card];
  if (!cardDef) {
    throw new Error(`Unsupported card type: ${card}`);
  }

  const coreModule = await loadCoreModule(coreVersion);

  for (const { exportName } of Object.values(CARDS)) {
    if (typeof coreModule[exportName] !== "function") {
      throw new Error(
        `Loaded ${CORE_PACKAGE_NAME} does not expose the expected '${exportName}' function.`,
      );
    }
  }

  const query = parseOptions(optionsInput);

  if (!query.username && process.env.GITHUB_REPOSITORY_OWNER) {
    // keep previous behavior for backwards compatibility;
    // repo cards may use `username` even though it's not required
    query.username = process.env.GITHUB_REPOSITORY_OWNER;
    if (cardDef.requires === "username") {
      warning("username not provided; defaulting to repository owner.");
    }
  }

  if (!query[cardDef.requires]) {
    throw new Error(`${cardDef.requires} is required for the ${card} card.`);
  }

  const handler = coreModule[cardDef.exportName];

  const outputPathValue =
    outputPathInput || path.join("profile", `${card}.svg`);
  const outputPath = resolveWorkspacePath(process.cwd(), outputPathValue);

  const result = await handler(query);
  const svg = result?.content;

  // The core renderer never throws on a data-fetch error; it returns a `status`
  // starting with "error" and a "Something went wrong" SVG. When fail_on_error
  // is enabled, fail the action so the broken card is never written or committed.
  // Older core versions may not return a `status`, so this is a no-op for them.
  if (failOnError && String(result?.status).startsWith("error")) {
    throw new Error(
      `Card generation failed while fetching data (${result.status}).`,
    );
  }

  if (!svg) {
    throw new Error("Card renderer returned empty output.");
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, svg, "utf8");
  info(`Wrote ${outputPath}`);
  setOutput("path", outputPathValue);
};
