import fs from 'fs/promises';
import path from 'path';
import { parse as parseTOML } from 'smol-toml';
import { DiscoveredService } from './schema';

const SKIP_DIRS = new Set([
  'target',
  'node_modules',
  '.git',
  '.idea',
  '.vscode',
  'tests',
  'benches',
  'examples',
]);
const MAX_FILE_SIZE = 200 * 1024; // 200KB per file (we split large ones, so raise the skip threshold)
const MAX_TOTAL_CHARS = 400_000; // ~100k tokens total per service
const FILE_SPLIT_THRESHOLD = 30_000; // 30K chars (~7.5K tokens) — split files larger than this

/**
 * Strip #[cfg(test)] mod blocks from Rust source.
 * These can be 60-80% of a well-tested file — useless for architecture analysis.
 */
function stripTestCode(content: string): string {
  const lines = content.split('\n');
  const out: string[] = [];
  let depth = 0; // brace depth inside a test block
  let inTest = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!inTest) {
      // Detect   #[cfg(test)]   optionally followed by   mod tests {
      if (/^\s*#\s*\[cfg\s*\(\s*test\s*\)\s*\]/.test(line)) {
        // Peek ahead: if the very next non-blank line starts a mod block, skip both
        let j = i + 1;
        while (j < lines.length && lines[j].trim() === '') j++;
        if (j < lines.length && /^\s*(pub\s+)?mod\s+\w+\s*\{/.test(lines[j])) {
          inTest = true;
          depth = 0;
          i = j - 1; // will be incremented to j by the loop
          continue;
        }
      }
      // Also catch   mod tests {   that comes right after the cfg attribute was already consumed
      out.push(line);
    } else {
      // Count braces to find the end of the test module
      for (const ch of line) {
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
      }
      if (depth <= 0) {
        inTest = false;
        depth = 0;
      }
    }
  }

  return out.join('\n');
}

/** Returns true for files that are only useful for testing, not architecture analysis */
function isTestOnlyFile(relativePath: string): boolean {
  const base = relativePath.split('/').pop() ?? '';
  return (
    base === 'test_utils.rs' ||
    base.startsWith('test_') ||
    base.endsWith('_test.rs') ||
    base.endsWith('_tests.rs') ||
    relativePath.includes('/test_utils/')
  );
}

export async function validateWorkspacePath(workspacePath: string): Promise<void> {
  const stat = await fs.stat(workspacePath);
  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: ${workspacePath}`);
  }
}

async function findCargoTomls(dir: string, results: string[] = []): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await findCargoTomls(fullPath, results);
    } else if (entry.name === 'Cargo.toml') {
      results.push(fullPath);
    }
  }
  return results;
}

function isWorkspaceRoot(tomlContent: string): boolean {
  try {
    const parsed = parseTOML(tomlContent);
    return 'workspace' in parsed && !('package' in parsed);
  } catch {
    return false;
  }
}

function getPackageName(tomlContent: string, dirName: string): string {
  try {
    const parsed = parseTOML(tomlContent);
    const pkg = parsed.package as Record<string, unknown> | undefined;
    if (pkg && typeof pkg.name === 'string') return pkg.name;
  } catch {
    // fall through
  }
  return dirName;
}

export async function discoverServices(workspacePath: string): Promise<DiscoveredService[]> {
  const cargoTomls = await findCargoTomls(workspacePath);
  const services: DiscoveredService[] = [];

  for (const tomlPath of cargoTomls) {
    const content = await fs.readFile(tomlPath, 'utf-8');
    if (isWorkspaceRoot(content)) continue;

    const serviceDir = path.dirname(tomlPath);
    const relativePath = path.relative(workspacePath, serviceDir);
    const dirName = path.basename(serviceDir);
    const name = getPackageName(content, dirName);

    services.push({
      name,
      path: relativePath || '.',
      cargoTomlPath: path.relative(workspacePath, tomlPath),
      rsFiles: [],
    });
  }

  return services;
}

async function findRsFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await findRsFiles(fullPath);
      results.push(...nested);
    } else if (entry.name.endsWith('.rs')) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Split a large Rust file at logical boundaries (impl blocks, fn definitions, mod blocks).
 * Each part keeps its path with a suffix like "src/main.rs [part 1/3]".
 */
function splitLargeFile(
  relativePath: string,
  content: string,
): Array<{ relativePath: string; content: string }> {
  if (content.length <= FILE_SPLIT_THRESHOLD) {
    return [{ relativePath, content }];
  }

  // Split at top-level item boundaries: impl, fn, pub fn, mod, struct, enum, trait
  const lines = content.split('\n');
  const parts: Array<{ relativePath: string; content: string }> = [];
  let currentLines: string[] = [];
  let currentSize = 0;

  // Collect use statements and top-level attributes as a shared header
  const headerLines: string[] = [];
  let headerDone = false;

  for (const line of lines) {
    if (!headerDone) {
      const trimmed = line.trim();
      if (
        trimmed.startsWith('use ') ||
        trimmed.startsWith('//') ||
        trimmed.startsWith('#[') ||
        trimmed.startsWith('pub use') ||
        trimmed === '' ||
        (trimmed.startsWith('mod ') && !trimmed.includes('{'))
      ) {
        headerLines.push(line);
        continue;
      }
      headerDone = true;
    }
    currentLines.push(line);
    currentSize += line.length + 1;

    // Split at top-level item boundaries when over threshold
    if (currentSize >= FILE_SPLIT_THRESHOLD) {
      const trimmed = line.trim();
      // Look for a good split point: closing brace at indent 0, or start of new item
      if (
        trimmed === '}' ||
        /^(pub\s+)?(async\s+)?fn\s/.test(trimmed) ||
        /^(pub\s+)?impl\s/.test(trimmed) ||
        /^(pub\s+)?struct\s/.test(trimmed) ||
        /^(pub\s+)?enum\s/.test(trimmed) ||
        /^(pub\s+)?trait\s/.test(trimmed)
      ) {
        parts.push({
          relativePath: `${relativePath} [part ${parts.length + 1}]`,
          content: [...headerLines, '', ...currentLines].join('\n'),
        });
        currentLines = [];
        currentSize = 0;
      }
    }
  }

  // Remaining lines
  if (currentLines.length > 0) {
    if (parts.length === 0) {
      // Never found a split point — return as single file
      return [{ relativePath, content }];
    }
    parts.push({
      relativePath: `${relativePath} [part ${parts.length + 1}]`,
      content: [...headerLines, '', ...currentLines].join('\n'),
    });
  }

  // Fix part numbering to include total
  const total = parts.length;
  return parts.map((p, i) => ({
    relativePath: `${relativePath} [part ${i + 1}/${total}]`,
    content: p.content,
  }));
}

export async function readServiceSource(
  workspacePath: string,
  service: DiscoveredService,
): Promise<DiscoveredService> {
  const serviceDir = path.join(workspacePath, service.path);
  const rsFiles = await findRsFiles(serviceDir);
  const fileContents: Array<{ relativePath: string; content: string }> = [];

  let totalChars = 0;
  for (const filePath of rsFiles) {
    const relativePath = path.relative(workspacePath, filePath);

    // Skip test-only files — they add noise without architecture value
    if (isTestOnlyFile(relativePath)) continue;

    const stat = await fs.stat(filePath);
    if (stat.size > MAX_FILE_SIZE) continue;

    let content = await fs.readFile(filePath, 'utf-8');

    // Strip #[cfg(test)] mod blocks — can be 60-80% of a well-tested Rust file
    content = stripTestCode(content);

    // Split large files at logical boundaries so each chunk is digestible
    const fileParts = splitLargeFile(relativePath, content);

    for (const part of fileParts) {
      if (totalChars + part.content.length > MAX_TOTAL_CHARS) break;
      totalChars += part.content.length;
      fileContents.push(part);
    }

    if (totalChars >= MAX_TOTAL_CHARS) break;
  }

  return { ...service, rsFiles: fileContents };
}
