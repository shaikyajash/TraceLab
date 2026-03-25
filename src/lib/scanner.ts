import fs from 'fs/promises';
import path from 'path';
import { parse as parseTOML } from 'smol-toml';
import { DiscoveredService } from './schema';

const SKIP_DIRS = new Set(['target', 'node_modules', '.git', '.idea', '.vscode']);
const MAX_FILE_SIZE = 100 * 1024; // 100KB

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

  for (const filePath of rsFiles) {
    const stat = await fs.stat(filePath);
    if (stat.size > MAX_FILE_SIZE) continue;
    const content = await fs.readFile(filePath, 'utf-8');
    fileContents.push({
      relativePath: path.relative(workspacePath, filePath),
      content,
    });
  }

  return { ...service, rsFiles: fileContents };
}
