"use client";

interface LandingPageProps {
  githubUrl: string;
  setGithubUrl: (url: string) => void;
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
          <div className="text-5xl font-bold tracking-[4px] mb-3">
            TRACE<span className="text-[#378ADD]">LAB</span>
          </div>
          <div className="text-sm text-[#666]">
            Visualize and trace your codebase architecture
          </div>
        </div>

        {/* Main Card */}
        <div className="bg-[#111114] border border-[#2a2a2e] rounded-2xl p-8 mb-6">
          {/* GitHub URL Section */}
          <div className="mb-6">
            <label className="block text-xs text-[#888] mb-2 font-medium">
              Paste a Git repository URL to scan and visualize
            </label>
            <form onSubmit={(e) => { e.preventDefault(); handleScan(); }} className="space-y-4">
              <input
                type="text"
                value={githubUrl}
                onChange={(e) => setGithubUrl(e.target.value)}
                placeholder="https://github.com/username/repository"
                disabled={isScanning}
                className="w-full bg-[#0a0a0c] border border-[#2a2a2e] rounded-lg px-4 py-3.5 text-[#ddd] text-sm placeholder:text-[#444] focus:border-[#378ADD] focus:ring-1 focus:ring-[#378ADD] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              />

              <div className="flex items-center justify-between gap-4">
                <label className="flex items-center gap-2.5 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={forceRescan}
                    onChange={(e) => setForceRescan(e.target.checked)}
                    disabled={isScanning}
                    className="w-4 h-4 accent-[#378ADD] cursor-pointer"
                  />
                  <span className="text-xs text-[#666] group-hover:text-[#888] transition-colors">
                    Force rescan (ignore cache)
                  </span>
                </label>

                <button
                  type="submit"
                  disabled={isScanning || !githubUrl.trim()}
                  className="px-8 py-3 bg-[#378ADD] hover:bg-[#4a9bef] text-white text-sm font-semibold rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[#378ADD]"
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
                </button>
              </div>
            </form>
          </div>

          {/* Scan Progress */}
          {isScanning && scanPhase && (
            <div className="bg-[#0a0a0c] border border-[#1a1a1c] rounded-lg p-4 mb-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-2 h-2 rounded-full bg-[#378ADD] animate-pulse" />
                <span className="text-xs text-[#378ADD] font-semibold tracking-wide uppercase">
                  {PHASE_LABELS[scanPhase] || scanPhase}
                </span>
              </div>
              <div className="text-xs text-[#666] leading-relaxed pl-5">
                {scanMessage}
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-[#2a1515] border border-[#4a2020] rounded-lg px-4 py-3 mb-6">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-[#ef4444] flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="text-sm text-[#fca5a5] leading-relaxed">
                  {error}
                </div>
              </div>
            </div>
          )}

          {/* Divider */}
          <div className="flex items-center gap-4 my-6">
            <div className="flex-1 h-px bg-[#2a2a2e]" />
            <span className="text-xs text-[#555] uppercase tracking-wider">or</span>
            <div className="flex-1 h-px bg-[#2a2a2e]" />
          </div>

          {/* Upload Section */}
          <label className="block group cursor-pointer">
            <div className="border-2 border-dashed border-[#2a2a2e] group-hover:border-[#378ADD] rounded-lg p-8 text-center transition-colors">
              <svg className="w-10 h-10 mx-auto mb-3 text-[#444] group-hover:text-[#378ADD] transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <div className="text-sm text-[#888] group-hover:text-[#aaa] transition-colors mb-1">
                Upload existing scan result
              </div>
              <div className="text-xs text-[#555]">
                Drop your .tracelab.json file here or click to browse
              </div>
            </div>
            <input type="file" accept=".json" onChange={handleUpload} className="hidden" />
          </label>
        </div>

        {/* Footer Info */}
        <div className="text-center text-xs text-[#555]">
          <p>Supports GitHub, GitLab, Gitea, and other Git repositories</p>
        </div>
      </div>
    </div>
  );
}
