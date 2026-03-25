import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { DiscoveredService } from "./schema";

export interface ResolvedExternalType {
  usePath: string;
  typeName: string;
  crateName: string;
  definition: string;
  sourceFile: string;
  serdeAttributes: string[];
  /** Pre-computed: the JSON values for each variant (for enums with serde renames) */
  serdeVariants?: Array<{ rustName: string; jsonValue: string }>;
}

// ─── Use-statement extraction ────────────────────────────────────────

const SKIP_CRATES = new Set([
  "std",
  "core",
  "alloc",
  "self",
  "super",
  "crate",
]);

/**
 * Extract all external `use` statements from source files.
 * Returns unique { crateName, typeName, fullPath } objects.
 */
function extractExternalUses(
  rsFiles: Array<{ relativePath: string; content: string }>,
): Array<{ crateName: string; typeName: string; fullPath: string }> {
  const uses = new Map<string, { crateName: string; typeName: string; fullPath: string }>();

  // Match: use foo::bar::Baz; and use foo::bar::{Baz, Qux};
  const useRegex = /use\s+([\w_][\w_:]*(?:\{[^}]+\})?)\s*;/g;

  for (const file of rsFiles) {
    let match;
    while ((match = useRegex.exec(file.content)) !== null) {
      const raw = match[1];
      const parts = raw.split("::");
      const crateName = parts[0].replace(/_/g, "-"); // Rust uses _ in code, - in crate names

      if (SKIP_CRATES.has(parts[0])) continue;

      // Handle brace groups: use foo::bar::{A, B}
      const lastPart = parts[parts.length - 1];
      if (lastPart.startsWith("{")) {
        const items = lastPart
          .replace(/[{}]/g, "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const prefix = parts.slice(0, -1).join("::");
        for (const item of items) {
          // Only capture PascalCase items (likely types, not functions)
          if (/^[A-Z]/.test(item)) {
            const fullPath = `${prefix}::${item}`;
            uses.set(fullPath, { crateName, typeName: item, fullPath });
          }
        }
      } else if (/^[A-Z]/.test(lastPart)) {
        uses.set(raw, { crateName, typeName: lastPart, fullPath: raw });
      }
    }
  }

  return Array.from(uses.values());
}

// ─── Cargo metadata ──────────────────────────────────────────────────

/**
 * Run `cargo metadata` in the workspace and return a map of
 * normalized_crate_name → source_directory_path.
 */
async function getCrateSourcePaths(
  workspacePath: string,
): Promise<Map<string, string>> {
  const pkgMap = new Map<string, string>();

  try {
    const raw = execSync("cargo metadata --format-version 1 2>/dev/null", {
      cwd: workspacePath,
      timeout: 15_000,
      maxBuffer: 10 * 1024 * 1024,
      encoding: "utf-8",
    });

    const meta = JSON.parse(raw);

    for (const pkg of meta.packages ?? []) {
      if (!pkg.manifest_path) continue;
      const srcDir = path.dirname(pkg.manifest_path);
      // Normalize: crate names use hyphens in Cargo but underscores in `use`
      pkgMap.set(pkg.name, srcDir);
      pkgMap.set(pkg.name.replace(/-/g, "_"), srcDir);
    }
  } catch {
    // cargo metadata failed — fall back to heuristic search
    await fallbackCrateSearch(workspacePath, pkgMap);
  }

  return pkgMap;
}

/**
 * Fallback: search ~/.cargo/ for crate sources by name.
 */
async function fallbackCrateSearch(
  workspacePath: string,
  pkgMap: Map<string, string>,
): Promise<void> {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const cargoDir = path.join(home, ".cargo");
  if (!fs.existsSync(cargoDir)) return;

  // Search git checkouts
  const gitCheckouts = path.join(cargoDir, "git", "checkouts");
  if (fs.existsSync(gitCheckouts)) {
    try {
      const repos = fs.readdirSync(gitCheckouts);
      for (const repo of repos) {
        const repoDir = path.join(gitCheckouts, repo);
        const revDirs = fs.readdirSync(repoDir).filter((d) => {
          try {
            return fs.statSync(path.join(repoDir, d)).isDirectory();
          } catch {
            return false;
          }
        });
        for (const rev of revDirs) {
          const revPath = path.join(repoDir, rev);
          const cargoToml = path.join(revPath, "Cargo.toml");
          if (fs.existsSync(cargoToml)) {
            try {
              const content = fs.readFileSync(cargoToml, "utf-8");
              const nameMatch = content.match(/name\s*=\s*"([^"]+)"/);
              if (nameMatch) {
                pkgMap.set(nameMatch[1], revPath);
                pkgMap.set(nameMatch[1].replace(/-/g, "_"), revPath);
              }
            } catch {
              /* skip */
            }
          }
          // Also check nested crates (workspace members)
          try {
            const subDirs = ["crates", "packages", "libs", "src"];
            for (const sub of subDirs) {
              const subPath = path.join(revPath, sub);
              if (!fs.existsSync(subPath)) continue;
              const members = fs.readdirSync(subPath);
              for (const member of members) {
                const memberToml = path.join(subPath, member, "Cargo.toml");
                if (fs.existsSync(memberToml)) {
                  try {
                    const c = fs.readFileSync(memberToml, "utf-8");
                    const nm = c.match(/name\s*=\s*"([^"]+)"/);
                    if (nm) {
                      pkgMap.set(nm[1], path.join(subPath, member));
                      pkgMap.set(nm[1].replace(/-/g, "_"), path.join(subPath, member));
                    }
                  } catch {
                    /* skip */
                  }
                }
              }
            }
          } catch {
            /* skip */
          }
        }
      }
    } catch {
      /* skip */
    }
  }

  // Search registry
  const registrySrc = path.join(cargoDir, "registry", "src");
  if (fs.existsSync(registrySrc)) {
    try {
      const indexes = fs.readdirSync(registrySrc);
      for (const idx of indexes) {
        const idxPath = path.join(registrySrc, idx);
        const crates = fs.readdirSync(idxPath);
        for (const crate of crates) {
          // Format: crate-name-version
          const dashIdx = crate.lastIndexOf("-");
          if (dashIdx > 0) {
            const name = crate.substring(0, dashIdx);
            pkgMap.set(name, path.join(idxPath, crate));
            pkgMap.set(name.replace(/-/g, "_"), path.join(idxPath, crate));
          }
        }
      }
    } catch {
      /* skip */
    }
  }
}

// ─── Type definition finder ──────────────────────────────────────────

const SERDE_ATTR_REGEX =
  /#\[serde\(([^)]*)\)\]/g;

const SERDE_RENAME_ALL_REGEX = /rename_all\s*=\s*"([^"]+)"/;
const SERDE_RENAME_REGEX = /rename\s*=\s*"([^"]+)"/;
const SERDE_TAG_REGEX = /tag\s*=\s*"([^"]+)"/;
const SERDE_DENY_UNKNOWN = /deny_unknown_fields/;

/**
 * Find a type definition in a crate source directory.
 * Returns the full definition block with attributes.
 */
function findTypeInDir(
  crateDir: string,
  typeName: string,
): { definition: string; sourceFile: string; serdeAttributes: string[] } | null {
  // Search the entire crate directory — not just src/ — because workspace
  // crates like `crates/primitives/src/` live deeper.
  const searchDir = crateDir;

  let rsFiles: string[];
  try {
    rsFiles = findRsFiles(searchDir);
  } catch {
    return null;
  }

  for (const filePath of rsFiles) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    // Find the type definition with preceding attributes
    const typeRegex = new RegExp(
      `((?:\\s*#\\[[^\\]]*\\]\\s*)*pub\\s+(?:enum|struct)\\s+${typeName}\\b[^{]*\\{)`,
      "m",
    );
    const match = typeRegex.exec(content);
    if (!match) continue;

    // Find the matching closing brace
    const startIdx = match.index;
    let braceCount = 0;
    let endIdx = startIdx;
    let foundOpen = false;

    for (let i = startIdx; i < content.length; i++) {
      if (content[i] === "{") {
        braceCount++;
        foundOpen = true;
      } else if (content[i] === "}") {
        braceCount--;
        if (foundOpen && braceCount === 0) {
          endIdx = i + 1;
          break;
        }
      }
    }

    const definition = content.substring(startIdx, endIdx).trim();

    // Extract serde attributes
    const serdeAttributes: string[] = [];
    let serdeMatch;
    const tempRegex = new RegExp(SERDE_ATTR_REGEX.source, "g");
    while ((serdeMatch = tempRegex.exec(definition)) !== null) {
      serdeAttributes.push(serdeMatch[1].trim());
    }

    return {
      definition,
      sourceFile: filePath,
      serdeAttributes,
    };
  }

  return null;
}

/**
 * Recursively find all .rs files in a directory.
 */
function findRsFiles(dir: string, maxDepth = 5): string[] {
  if (maxDepth <= 0) return [];
  const files: string[] = [];

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "target" || entry.name === ".git") continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isFile() && entry.name.endsWith(".rs")) {
        files.push(fullPath);
      } else if (entry.isDirectory()) {
        files.push(...findRsFiles(fullPath, maxDepth - 1));
      }
    }
  } catch {
    /* skip unreadable dirs */
  }

  return files;
}

// ─── Serde variant computation ───────────────────────────────────────

function applyRenameAll(variant: string, rule: string): string {
  switch (rule) {
    case "lowercase":
      return variant.toLowerCase();
    case "UPPERCASE":
      return variant.toUpperCase();
    case "camelCase": {
      const first = variant[0].toLowerCase();
      return first + variant.slice(1);
    }
    case "snake_case":
      return variant
        .replace(/([A-Z])/g, "_$1")
        .toLowerCase()
        .replace(/^_/, "");
    case "SCREAMING_SNAKE_CASE":
      return variant
        .replace(/([A-Z])/g, "_$1")
        .toUpperCase()
        .replace(/^_/, "");
    case "kebab-case":
      return variant
        .replace(/([A-Z])/g, "-$1")
        .toLowerCase()
        .replace(/^-/, "");
    case "PascalCase":
      return variant; // Already PascalCase in Rust
    default:
      return variant;
  }
}

/**
 * Extract enum variants and compute their serde JSON values.
 */
function computeSerdeVariants(
  definition: string,
  serdeAttributes: string[],
): Array<{ rustName: string; jsonValue: string }> | undefined {
  // Only for enums
  if (!definition.includes("pub enum")) return undefined;

  // Get rename_all from container attributes
  let renameAll: string | null = null;
  for (const attr of serdeAttributes) {
    const m = SERDE_RENAME_ALL_REGEX.exec(attr);
    if (m) renameAll = m[1];
  }

  // Extract variant names (simple variants, not complex ones)
  const variantRegex =
    /(?:#\[serde\(([^)]*)\)\]\s*)?(\w+)(?:\s*\{[^}]*\}|\s*\([^)]*\))?\s*,/g;
  const bodyMatch = definition.match(/\{([\s\S]*)\}/);
  if (!bodyMatch) return undefined;

  // Strip doc comments to avoid false matches
  const body = bodyMatch[1].replace(/\/\/\/[^\n]*/g, "").replace(/\/\/[^\n]*/g, "");
  const variants: Array<{ rustName: string; jsonValue: string }> = [];
  let vm;
  while ((vm = variantRegex.exec(body)) !== null) {
    const variantSerdeAttr = vm[1] || "";
    const rustName = vm[2];
    if (!rustName || rustName === "pub" || rustName === "fn") continue;

    // Check for per-variant #[serde(rename = "...")]
    const renameMatch = SERDE_RENAME_REGEX.exec(variantSerdeAttr);
    let jsonValue: string;
    if (renameMatch) {
      jsonValue = renameMatch[1];
    } else if (renameAll) {
      jsonValue = applyRenameAll(rustName, renameAll);
    } else {
      jsonValue = rustName;
    }

    variants.push({ rustName, jsonValue });
  }

  return variants.length > 0 ? variants : undefined;
}

// ─── Main entry point ────────────────────────────────────────────────

/**
 * Resolve all external types used by a service.
 */
export async function resolveExternalTypes(
  workspacePath: string,
  service: DiscoveredService,
): Promise<ResolvedExternalType[]> {
  const externalUses = extractExternalUses(service.rsFiles);
  if (externalUses.length === 0) return [];

  const crateSourcePaths = await getCrateSourcePaths(workspacePath);
  const resolved: ResolvedExternalType[] = [];

  for (const usage of externalUses) {
    if (resolved.length >= 50) break; // cap to avoid prompt bloat

    // Try exact crate name, then with underscores
    const crateDir =
      crateSourcePaths.get(usage.crateName) ||
      crateSourcePaths.get(usage.crateName.replace(/-/g, "_"));

    if (!crateDir) continue;

    const found = findTypeInDir(crateDir, usage.typeName);
    if (!found) continue;

    const serdeVariants = computeSerdeVariants(
      found.definition,
      found.serdeAttributes,
    );

    resolved.push({
      usePath: usage.fullPath,
      typeName: usage.typeName,
      crateName: usage.crateName,
      definition: found.definition,
      sourceFile: found.sourceFile,
      serdeAttributes: found.serdeAttributes,
      serdeVariants,
    });
  }

  return resolved;
}

/**
 * Format resolved types into a string for LLM context.
 */
export function formatExternalTypesForPrompt(
  types: ResolvedExternalType[],
): string {
  if (types.length === 0) return "";

  const sections = types.map((t) => {
    let section = `--- EXTERNAL TYPE: ${t.usePath} (from crate: ${t.crateName}) ---\n`;
    section += t.definition + "\n";

    if (t.serdeAttributes.length > 0) {
      section += `Serde attributes: ${t.serdeAttributes.join(", ")}\n`;
    }

    if (t.serdeVariants && t.serdeVariants.length > 0) {
      section += `Valid JSON values: ${t.serdeVariants.map((v) => `"${v.jsonValue}"`).join(", ")}\n`;
      section += `Mapping: ${t.serdeVariants.map((v) => `${v.rustName} → "${v.jsonValue}"`).join(", ")}\n`;
    }

    section += `--- END EXTERNAL TYPE ---`;
    return section;
  });

  return sections.join("\n\n");
}
