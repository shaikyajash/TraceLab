import { NextRequest } from 'next/server';
import fs from 'fs/promises';
import pathMod from 'path';

export async function POST(request: NextRequest) {
  const { path: inputPath } = await request.json();

  if (!inputPath || typeof inputPath !== 'string') {
    return Response.json({ error: 'path is required' }, { status: 400 });
  }

  let filePath = inputPath.trim();

  try {
    /* if it's a directory, look for components.json inside it */
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      filePath = pathMod.join(filePath, 'components.json');
    }
  } catch {
    /* stat failed — might just be a file that doesn't exist yet, let readFile handle it */
  }

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const graph = JSON.parse(content);
    
    // Strip source_code from nodes to reduce payload size
    if (graph.nodes && Array.isArray(graph.nodes)) {
      for (const node of graph.nodes) {
        delete node.source_code;
      }
    }
    
    return Response.json(graph);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to read file';
    return Response.json({ error: message }, { status: 400 });
  }
}
