import fs from "node:fs/promises";
import path from "node:path";

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export function safeJoin(root: string, rel: string): string {
  const target = path.resolve(root, rel);
  const safeRoot = path.resolve(root);
  if (!target.startsWith(safeRoot + path.sep) && target !== safeRoot) {
    throw new Error("Unsafe path");
  }
  return target;
}
