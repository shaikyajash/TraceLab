import { GoogleGenerativeAI } from '@google/generative-ai';
import * as fs from 'fs';
import * as path from 'path';
import { VisualizerSchema } from '@/types/visualizer';

export class RepoScanner {
  private genAI: GoogleGenerativeAI;
  private model: any;

  constructor(apiKey?: string) {
    const key = apiKey || process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error('GEMINI_API_KEY not found in environment variables');
    }
    
    console.log('Initializing Gemini with API key...');
    
    this.genAI = new GoogleGenerativeAI(key);
    
    // Use gemini-2.5-flash - latest stable model
    this.model = this.genAI.getGenerativeModel({ 
      model: 'gemini-2.5-flash'
    });
    
    console.log('Gemini initialized with model: gemini-2.5-flash');
  }

  async scanRepository(repoPath: string): Promise<VisualizerSchema> {
    const files = this.getAllFiles(repoPath);
    const codeContext = this.buildCodeContext(files);
    
    const schema = await this.analyzeWithLLM(codeContext);
    return schema;
  }

  private getAllFiles(dir: string, fileList: string[] = []): string[] {
    const files = fs.readdirSync(dir);
    
    files.forEach(file => {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      
      if (stat.isDirectory()) {
        if (!file.startsWith('.') && file !== 'node_modules' && file !== 'target') {
          this.getAllFiles(filePath, fileList);
        }
      } else {
        const ext = path.extname(file);
        if (['.rs', '.ts', '.js', '.go', '.py', '.java'].includes(ext)) {
          fileList.push(filePath);
        }
      }
    });
    
    return fileList;
  }

  private buildCodeContext(files: string[]): string {
    return files.map(file => {
      const content = fs.readFileSync(file, 'utf-8');
      return `// File: ${file}\n${content}\n\n`;
    }).join('');
  }

  private async analyzeWithLLM(codeContext: string): Promise<VisualizerSchema> {
    const prompt = `You are analyzing a codebase to extract API architecture for visualization.

CRITICAL REQUIREMENTS:
1. Find ALL HTTP routes (GET, POST, PUT, DELETE, PATCH)
2. Extract the ACTUAL port number from server configuration
3. Create REALISTIC example payloads for EVERY route by analyzing:
   - Validation schemas (Zod, Joi, Yup, class-validator)
   - TypeScript interfaces and types
   - Request body parsing code
   - Test files with example data
   - Function parameters and their types
4. Map the complete data flow through all components

PAYLOAD CONSTRUCTION RULES:
- For POST/PUT/PATCH: Create a complete request body with all required fields
- For GET/DELETE: Include query parameters or path parameters if needed
- Use realistic values (real names, emails, numbers)
- Match the exact field names from validation/types
- Include nested objects if the schema requires them
- If you see validation like "email must be valid", use a valid email format
- If you see "age must be number", use a realistic number

EXAMPLES OF GOOD PAYLOADS:
POST /api/users:
{
  "name": "Alice Johnson",
  "email": "alice.johnson@example.com",
  "age": 28,
  "role": "admin"
}

POST /api/journal:
{
  "title": "My First Entry",
  "content": "Today was a great day...",
  "mood": "happy",
  "tags": ["personal", "reflection"]
}

GET /api/users/:id:
{
  "id": "user_abc123"
}

Analyze this codebase and extract:

1. SERVER CONFIGURATION:
   - Find server.listen(), app.listen(), or port configuration
   - Extract the actual port number (e.g., 3000, 8080, 3002)
   - Identify the language/framework (Express, Next.js, FastAPI, etc.)

2. HTTP ROUTES:
   - Find all route definitions: app.get(), app.post(), router.get(), @app.route(), etc.
   - Extract: path, method, handler function name
   - Create realistic example payloads based on validation/schema in code

3. DATA FLOW:
   - Trace how each route calls internal components
   - Map: Route → Middleware → Service → Repository → External APIs
   - Show data transformations at each step

4. INTERNAL COMPONENTS:
   - Services, repositories, middleware, utilities
   - Extract function names, parameters, return types

Return ONLY valid JSON (no markdown, no code blocks):

{
  "servers": [{
    "id": "unique-id",
    "name": "Server Name",
    "port": <actual_port_number>,
    "language": "typescript|javascript|python|go|rust",
    "routes": [{
      "id": "route-id",
      "path": "/api/users",
      "method": "GET|POST|PUT|DELETE|PATCH",
      "handler": "function name",
      "examplePayload": {
        "field1": "realistic value",
        "field2": 123,
        "nested": {
          "field3": "value"
        }
      },
      "flowSteps": [{
        "componentId": "component-id",
        "functionName": "functionName",
        "order": 0,
        "dataTransformation": {
          "input": "describe input",
          "output": "describe output",
          "description": "what this step does"
        }
      }]
    }],
    "internalComponents": [{
      "id": "component-id",
      "name": "ComponentName",
      "type": "handler|middleware|service|repository|util",
      "filePath": "path/to/file.ts",
      "functions": [{
        "name": "functionName",
        "params": ["param: type"],
        "returns": "ReturnType",
        "transformsData": true|false
      }]
    }],
    "externalCalls": [{
      "from": "component-id",
      "to": "external-service-id",
      "method": "GET|POST",
      "endpoint": "/api/endpoint"
    }]
  }],
  "externalServices": [{
    "id": "service-id",
    "name": "Service Name",
    "baseUrl": "https://api.example.com"
  }]
}

IMPORTANT:
- examplePayload MUST be realistic and complete for EVERY route
- For GET requests with no body, use {} or include query params
- port must be the actual number from server config
- Include ALL routes you find
- Map complete flow for each route
- DO NOT wrap response in markdown code blocks

Code to analyze:
${codeContext.slice(0, 100000)}`;

    try {
      console.log('Calling Gemini API with model: gemini-2.5-flash');
      const result = await this.model.generateContent(prompt);
      const response = result.response;
      let text = response.text();
      
      console.log('Gemini response received, parsing JSON...');
      console.log('Raw response length:', text.length);
      console.log('First 500 chars:', text.substring(0, 500));
      
      // Clean up response - remove markdown code blocks if present
      text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      
      console.log('After cleanup, first 500 chars:', text.substring(0, 500));
      
      const parsed = JSON.parse(text);
      console.log('JSON parsed successfully!');
      
      // Post-process: Ensure all routes have non-null payloads
      parsed.servers.forEach((server: any) => {
        server.routes.forEach((route: any) => {
          if (!route.examplePayload || route.examplePayload === null) {
            // Provide a default based on method
            if (['POST', 'PUT', 'PATCH'].includes(route.method)) {
              route.examplePayload = { data: 'example' };
            } else {
              route.examplePayload = {};
            }
          }
        });
      });
      
      return parsed;
    } catch (error: any) {
      console.error('Gemini API error:', error);
      console.error('Error details:', {
        status: error.status,
        statusText: error.statusText,
        errorDetails: error.errorDetails
      });
      
      // If model not found, suggest alternatives
      if (error.message?.includes('not found') || error.message?.includes('404')) {
        throw new Error(`Gemini model not available. Try: gemini-1.5-flash, gemini-1.5-pro, or gemini-pro. Original error: ${error.message}`);
      }
      
      throw new Error(`Gemini API failed: ${error.message}`);
    }
  }

  async saveSchema(schema: VisualizerSchema, outputPath: string) {
    fs.writeFileSync(outputPath, JSON.stringify(schema, null, 2));
  }
}
