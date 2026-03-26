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
const MAX_FILE_SIZE = 100 * 1024; // 100KB per file
const MAX_TOTAL_CHARS = 400_000; // ~100k tokens total per service

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

    if (totalChars + content.length > MAX_TOTAL_CHARS) break;
    totalChars += content.length;
    fileContents.push({ relativePath, content });
  }

  return { ...service, rsFiles: fileContents };
}
