#!/usr/bin/env node

import { RepoScanner } from '../src/lib/repo-scanner';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 1) {
    console.error('Usage: npm run scan <repo-path> [gemini-api-key]');
    console.error('Note: If API key not provided, will use GEMINI_API_KEY from .env');
    process.exit(1);
  }

  const [repoPath, apiKey] = args;
  const outputPath = path.join(process.cwd(), 'public', 'visualizer.json');

  console.log('Scanning repository:', repoPath);
  console.log('Using Gemini 1.5 Pro...');
  console.log('This may take a few minutes...\n');

  const scanner = new RepoScanner(apiKey);
  const schema = await scanner.scanRepository(repoPath);

  await scanner.saveSchema(schema, outputPath);

  console.log('\n✓ Scan complete!');
  console.log('Generated:', outputPath);
  console.log('\nFound:');
  console.log(`- ${schema.servers.length} server(s)`);
  schema.servers.forEach(server => {
    console.log(`  - ${server.name} (${server.language}) on port ${server.port}`);
    console.log(`    - ${server.routes.length} route(s)`);
    console.log(`    - ${server.internalComponents.length} component(s)`);
  });
}

main().catch(console.error);
