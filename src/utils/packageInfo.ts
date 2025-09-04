import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface PackageInfo {
  name: string;
  version: string;
  description?: string;
  [key: string]: unknown;
}

let cachedPackageInfo: PackageInfo | null = null;

export function getPackageInfo(): PackageInfo {
  if (cachedPackageInfo) {
    return cachedPackageInfo;
  }

  try {
    const packagePath = join(__dirname, "..", "..", "package.json");
    const packageContent = readFileSync(packagePath, "utf-8");
    cachedPackageInfo = JSON.parse(packageContent) as PackageInfo;
    return cachedPackageInfo;
  } catch (error) {
    // Fallback values
    return {
      name: "Postify",
      version: "1.1.0",
      description:
        "Telegram channel management bot built with TypeScript, grammy, MongoDB & Agenda to manage your channel contents effortlessly!",
    };
  }
}
