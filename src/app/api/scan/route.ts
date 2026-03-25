import { NextRequest } from 'next/server';
import { RepoScanner } from '@/lib/repo-scanner';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function POST(request: NextRequest) {
  try {
    const { repoPath, repoName, backendUrl } = await request.json();

    if (!repoPath) {
      return Response.json(
        { error: 'repoPath is required' },
        { status: 400 }
      );
    }

    // Use API key from environment
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return Response.json(
        { error: 'GEMINI_API_KEY not configured in environment' },
        { status: 500 }
      );
    }

    let actualPath = repoPath;

    // If it's a GitHub URL, clone it first
    if (repoPath.startsWith('http://') || repoPath.startsWith('https://')) {
      console.log('Cloning GitHub repository:', repoPath);
      
      const tempDir = path.join(process.cwd(), 'temp-repos', repoName || 'repo');
      
      // Create temp directory
      if (!fs.existsSync(path.dirname(tempDir))) {
        fs.mkdirSync(path.dirname(tempDir), { recursive: true });
      }

      // Remove if exists
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }

      try {
        // Clone the repository
        await execAsync(`git clone ${repoPath} "${tempDir}"`);
        actualPath = tempDir;
        console.log('Repository cloned to:', tempDir);
      } catch (error: any) {
        return Response.json(
          { error: 'Failed to clone repository: ' + error.message },
          { status: 400 }
        );
      }
    }

    console.log('Scanning repository at:', actualPath);
    const scanner = new RepoScanner(apiKey);
    const schema = await scanner.scanRepository(actualPath);

    // If backend URL is provided, update the port in schema
    if (backendUrl) {
      console.log('Using provided backend URL:', backendUrl);
      const url = new URL(backendUrl);
      const port = url.port ? parseInt(url.port) : (url.protocol === 'https:' ? 443 : 80);
      
      // Update all servers to use the provided URL
      schema.servers.forEach(server => {
        server.port = port;
        // Store the full base URL for later use
        (server as any).baseUrl = backendUrl;
      });
    }

    const outputPath = path.join(process.cwd(), 'public', 'visualizer.json');
    await scanner.saveSchema(schema, outputPath);

    // Cleanup temp directory if we cloned
    if (actualPath !== repoPath && fs.existsSync(actualPath)) {
      fs.rmSync(actualPath, { recursive: true, force: true });
    }

    return Response.json({ success: true, schema });
  } catch (error: any) {
    console.error('Scan error:', error);
    return Response.json(
      { error: error.message || 'Scan failed' },
      { status: 500 }
    );
  }
}
