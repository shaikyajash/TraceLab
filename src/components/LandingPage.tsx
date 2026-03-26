"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";

interface LandingPageProps {
  githubUrl: string;
  setGithubUrl: (url: string) => void;
  branch: string;
  setBranch: (branch: string) => void;
  forceRescan: boolean;
  setForceRescan: (force: boolean) => void;
  isScanning: boolean;
  scanPhase: string;
  scanMessage: string;
  error: string | null;
  handleScan: () => void;
  handleUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

const PHASE_LABELS: Record<string, string> = {
  discovering: "Discovering",
  reading: "Reading",
  analyzing: "Analyzing",
  cross_service: "Cross-service",
  merging: "Writing",
};

export default function LandingPage(props: LandingPageProps) {
  const {
    githubUrl,
    setGithubUrl,
    branch,
    forceRescan,
    setForceRescan,
    isScanning,
    scanPhase,
    scanMessage,
    error,
    handleScan,
    handleUpload,
  } = props;

  return (
    <div className="bg-[#0d0d0f] text-[#ddd] min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-2xl">
        {/* Logo */}
        <div className="text-center mb-16">
          <h1 className="text-5xl font-bold tracking-[4px] mb-3">
            TRACE<span className="text-[#378ADD]">LAB</span>
          </h1>
          <p className="text-sm text-[#666]">
            Visualize and trace your codebase architecture
          </p>
        </div>

        {/* Main Card */}
        <Card className="bg-[#111114] border-[#2a2a2e] mb-6">
          <CardContent className="p-8">
            {/* GitHub URL Section */}
            <div className="mb-6">
              <Label htmlFor="github-url" className="text-xs text-[#888] mb-2 font-medium">
                Paste a Git repository URL to scan and visualize
              </Label>
              <form onSubmit={(e) => { e.preventDefault(); handleScan(); }} className="space-y-4">
                <Input
                  id="github-url"
                  type="text"
                  value={githubUrl}
                  onChange={(e) => setGithubUrl(e.target.value)}
                  placeholder="Paste git clone command or repository URL"
                  disabled={isScanning}
                  className="bg-[#0a0a0c] border-[#2a2a2e] text-[#ddd] placeholder:text-[#444] focus:border-[#378ADD] focus:ring-[#378ADD]"
                />

                {branch && (
                  <div className="text-xs text-[#888] flex items-center gap-2">
                    <span className="text-[#378ADD]">Branch:</span>
                    <span className="font-mono">{branch}</span>
                  </div>
                )}

                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2.5">
                    <Checkbox
                      id="force-rescan"
                      checked={forceRescan}
                      onCheckedChange={(checked: boolean) => setForceRescan(checked)}
                      disabled={isScanning}
                      className=" bg-gray-800 data-[state=checked]:bg-[#378ADD] data-[state=checked]:border-[#378ADD]"
                    />
                    <Label
                      htmlFor="force-rescan"
                      className="text-xs text-[#666] hover:text-[#888] transition-colors cursor-pointer"
                    >
                      Force rescan (ignore cache)
                    </Label>
                  </div>

                  <Button
                    type="submit"
                    disabled={isScanning || !githubUrl.trim()}
                    className="bg-[#378ADD] hover:bg-[#4a9bef] text-white"
                  >
                    {isScanning ? (
                      <span className="flex items-center gap-2">
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Scanning...
                      </span>
                    ) : "Scan & Visualize"}
                  </Button>
                </div>
              </form>
            </div>

            {/* Scan Progress */}
            {isScanning && scanPhase && (
              <Alert className="bg-[#0a0a0c] border-[#1a1a1c] mb-6">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-2 h-2 rounded-full bg-[#378ADD] animate-pulse" />
                  <span className="text-xs text-[#378ADD] font-semibold tracking-wide uppercase">
                    {PHASE_LABELS[scanPhase] || scanPhase}
                  </span>
                </div>
                <AlertDescription className="text-xs text-[#666] leading-relaxed pl-5">
                  {scanMessage}
                </AlertDescription>
              </Alert>
            )}

            {/* Error */}
            {error && (
              <Alert variant="destructive" className="bg-[#2a1515] border-[#4a2020] mb-6">
                <div className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-[#ef4444] shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <AlertDescription className="text-sm text-[#fca5a5] leading-relaxed">
                    {error}
                  </AlertDescription>
                </div>
              </Alert>
            )}

            {/* Divider */}
            <div className="flex items-center gap-4 my-6">
              <div className="flex-1 h-px bg-[#2a2a2e]" />
              <span className="text-xs text-[#555] uppercase tracking-wider">or</span>
              <div className="flex-1 h-px bg-[#2a2a2e]" />
            </div>

            {/* Upload Section */}
            <Label htmlFor="file-upload" className="block group cursor-pointer">
              <div className="border-2 border-dashed border-[#2a2a2e] group-hover:border-[#378ADD] rounded-lg p-8 text-center transition-colors">
                <svg className="w-10 h-10 mx-auto mb-3 text-[#444] group-hover:text-[#378ADD] transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <div className="text-sm text-[#888] group-hover:text-[#aaa] transition-colors mb-1">
                  import existing scan result
                </div>
                <p className="text-xs text-[#555]">
                  Drop your .tracelab.json file here or click to browse
                </p>
              </div>
              <input id="file-upload" type="file" accept=".json" onChange={handleUpload} className="hidden" />
            </Label>
          </CardContent>
        </Card>

        {/* Footer Info */}
        <p className="text-center text-xs text-[#555]">
          Supports GitHub, GitLab, Gitea, and other Git repositories
        </p>
      </div>
    </div>
  );
}
