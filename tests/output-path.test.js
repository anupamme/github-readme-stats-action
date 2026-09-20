import path from "node:path";

import { describe, expect, test } from "vitest";

import { resolveWorkspacePath } from "../action.js";

describe("resolveWorkspacePath", () => {
  const baseDir = path.sep === "\\" ? "C:\\workspace" : "/workspace";

  test("resolves a relative path inside the workspace", () => {
    expect(
      resolveWorkspacePath(baseDir, path.join("profile", "stats.svg")),
    ).toBe(path.join(baseDir, "profile", "stats.svg"));
  });

  test("resolves the workspace root itself", () => {
    expect(resolveWorkspacePath(baseDir, ".")).toBe(baseDir);
  });

  test("resolves an absolute path inside the workspace", () => {
    const target = path.join(baseDir, "profile", "stats.svg");
    expect(resolveWorkspacePath(baseDir, target)).toBe(target);
  });

  test("rejects traversal that escapes the workspace", () => {
    expect(() =>
      resolveWorkspacePath(baseDir, path.join("..", "..", "etc", "passwd")),
    ).toThrow("path must resolve within the workspace directory.");
  });

  test("rejects an absolute path outside the workspace", () => {
    const outside =
      path.sep === "\\" ? "C:\\elsewhere\\evil.svg" : "/elsewhere/evil.svg";
    expect(() => resolveWorkspacePath(baseDir, outside)).toThrow(
      "path must resolve within the workspace directory.",
    );
  });

  test("rejects a sibling directory sharing the workspace's string prefix", () => {
    // baseDir + "-evil" starts with baseDir as a raw string, but is not
    // actually nested inside it -- the check must use a path-separator-aware
    // comparison rather than a naive startsWith(baseDir).
    const sibling = `${baseDir}-evil${path.sep}stats.svg`;
    expect(() => resolveWorkspacePath(baseDir, sibling)).toThrow(
      "path must resolve within the workspace directory.",
    );
  });
});
