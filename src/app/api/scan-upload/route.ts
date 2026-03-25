import { NextRequest } from 'next/server';
import { RepoScanner } from '@/lib/repo-scanner';
import * as fs from 'fs';
import * as path from 'path';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const repoName = formData.get('repoName') as string;
    const files = formData.getAll('files') as File[];

    if (!repoName || files.length === 0) {
      return Response.json(
        { error: 'repoName and files are required' },
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

    // Create temp directory for uploaded files
    const tempDir = path.join(process.cwd(), 'temp-repos', repoName);
    
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Save uploaded files
    console.log(`Saving ${files.length} uploaded files...`);
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const filePath = path.join(tempDir, file.name);
      
      // Create subdirectories if needed
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.writeFileSync(filePath, buffer);
    }

    console.log('Scanning uploaded files at:', tempDir);
    const scanner = new RepoScanner(apiKey);
    const schema = await scanner.scanRepository(tempDir);

    const outputPath = path.join(process.cwd(), 'public', 'visualizer.json');
    await scanner.saveSchema(schema, outputPath);

    // Cleanup temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    return Response.json({ success: true, schema });
  } catch (error: any) {
    console.error('Upload scan error:', error);
    return Response.json(
      { error: error.message || 'Scan failed' },
      { status: 500 }
    );
  }
}
