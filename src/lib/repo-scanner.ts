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
    const prompt = `You are a code analyzer that extracts API architecture from any codebase (Rust, TypeScript, JavaScript, Python, Go, Java).

For Rust code, you analyze:
- Route handlers (Actix-web, Axum, Rocket, Warp)
- Transformers, validators, middleware
- Business logic, DB calls, external HTTP calls
- Structs/Enums as data carriers
- Message queue operations

For TypeScript/JavaScript:
- Express routes, Next.js API routes
- Middleware, services, repositories
- Database operations, external API calls

For Python:
- FastAPI, Flask routes
- Services, repositories, validators

For Go:
- http.HandleFunc, mux routes
- Handlers, services, repositories

You MUST respond with valid JSON only. No prose, no markdown fences, no explanations. Just the JSON object.

CRITICAL REQUIREMENTS:
1. Find ALL HTTP routes (GET, POST, PUT, DELETE, PATCH)
2. Extract the ACTUAL port number from server configuration
3. Create REALISTIC example payloads for EVERY route
4. Map the complete data flow through all components
5. If NO routes found, create 2-3 example routes based on the service logic

ROUTE DETECTION PATTERNS:

Rust:
- Actix-web: #[get("/path")], #[post("/path")], web::get().to(handler), HttpServer::new().bind("0.0.0.0:8080")
- Axum: Router::new().route("/path", get(handler)), axum::Server::bind("0.0.0.0:8080")
- Rocket: #[get("/path")], #[post("/path")], rocket::build().mount("/", routes![...])
- Warp: warp::path!("api" / "users").and(warp::get()), warp::serve(routes).run(([0,0,0,0], 8080))

TypeScript/JavaScript:
- Express: app.get("/path", handler), app.listen(3000)
- Next.js: export async function GET/POST in route.ts files

Python:
- FastAPI: @app.get("/path"), @app.post("/path"), uvicorn.run(app, port=8000)
- Flask: @app.route("/path", methods=["GET"]), app.run(port=5000)

Go:
- http.HandleFunc("/path", handler), http.ListenAndServe(":8080", nil)
- mux.HandleFunc("/path", handler)

PAYLOAD CONSTRUCTION:
- Analyze struct definitions, validation schemas, function parameters
- Create realistic values (real names, emails, numbers)
- Match exact field names from types/schemas
- Include nested objects if required

Output JSON schema:
{
  "servers": [{
    "id": "unique-id",
    "name": "Service Name",
    "port": 8080,
    "language": "rust|typescript|javascript|python|go|java",
    "routes": [{
      "id": "route-id",
      "path": "/api/users",
      "method": "GET|POST|PUT|DELETE|PATCH",
      "handler": "handler_function_name",
      "examplePayload": {
        "field1": "realistic value",
        "field2": 123,
        "nested": { "field3": "value" }
      },
      "flowSteps": [{
        "componentId": "component-id",
        "functionName": "function_name",
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
      "type": "handler|middleware|service|repository|util|validator",
      "filePath": "path/to/file.rs",
      "functions": [{
        "name": "function_name",
        "params": ["param: Type"],
        "returns": "ReturnType",
        "transformsData": true
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
    "name": "External Service Name",
    "baseUrl": "https://api.example.com"
  }]
}

IMPORTANT:
- Return ONLY valid JSON, no markdown code blocks
- examplePayload MUST be realistic and complete for EVERY route
- For GET requests with no body, use {} or include query params
- port must be the actual number from server config (default: 8080 for Rust, 3000 for Node.js, 8000 for Python)
- If NO routes found, create 2-3 example routes based on structs/functions you see
- Map complete data flow for each route

Code to analyze:
${codeContext.slice(0, 100000)}`;

    try {
      console.log('Calling Gemini API with model: gemini-2.5-flash');
      const result = await this.model.generateContent(prompt);
      const response = result.response;
      let text = response.text();
      
      console.log('Gemini response received');
      console.log('Raw response length:', text.length);
      
      // Save raw response to file for debugging
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const logPath = path.join(process.cwd(), 'public', `gemini-response-${timestamp}.txt`);
      fs.writeFileSync(logPath, text);
      console.log('Raw Gemini response saved to:', logPath);
      
      // Clean up response - remove markdown code blocks if present
      text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      
      // Try to extract JSON if it's embedded in other text
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        text = jsonMatch[0];
      }
      
      console.log('Cleaned response length:', text.length);
      console.log('First 500 chars:', text.substring(0, 500));
      
      let parsed;
      try {
        parsed = JSON.parse(text);
        console.log('JSON parsed successfully!');
      } catch (parseError: any) {
        console.error('JSON parse error:', parseError.message);
        console.error('Error at position:', parseError.message.match(/position (\d+)/)?.[1]);
        
        // Save the cleaned text for debugging
        const cleanedPath = path.join(process.cwd(), 'public', `gemini-cleaned-${timestamp}.txt`);
        fs.writeFileSync(cleanedPath, text);
        console.log('Cleaned response saved to:', cleanedPath);
        
        // Try to fix common JSON issues
        try {
          // Remove trailing commas
          text = text.replace(/,(\s*[}\]])/g, '$1');
          // Fix unescaped quotes in strings
          text = text.replace(/([^\\])"([^"]*)":/g, '$1\\"$2":');
          
          parsed = JSON.parse(text);
          console.log('JSON parsed after repair!');
        } catch (repairError) {
          throw new Error(`Failed to parse JSON even after repair. Check ${cleanedPath} for details. Error: ${parseError.message}`);
        }
      }
      
      // Post-process: Ensure all routes have non-null payloads
      if (parsed.servers) {
        parsed.servers.forEach((server: any) => {
          if (server.routes) {
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
          }
        });
      }
      
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
