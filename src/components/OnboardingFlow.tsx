'use client';

import React, { useState } from 'react';

interface OnboardingFlowProps {
  onComplete: () => void;
}

export default function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const [step, setStep] = useState<'name' | 'scan' | 'scanning' | 'done'>('name');
  const [repoName, setRepoName] = useState('');
  const [repoPath, setRepoPath] = useState('');
  const [backendUrl, setBackendUrl] = useState('');
  const [uploadMode, setUploadMode] = useState<'path' | 'upload'>('path');
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanStatus, setScanStatus] = useState('');
  const [error, setError] = useState('');

  const handleFileUpload = (files: FileList | null) => {
    if (!files) return;
    
    const fileArray = Array.from(files);
    // Filter for code files
    const codeFiles = fileArray.filter(file => {
      const ext = file.name.split('.').pop()?.toLowerCase();
      return ['ts', 'tsx', 'js', 'jsx', 'rs', 'go', 'py', 'java', 'c', 'cpp', 'h', 'hpp'].includes(ext || '');
    });
    
    setUploadedFiles(prev => [...prev, ...codeFiles]);
    setError('');
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    handleFileUpload(e.dataTransfer.files);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleStartScan = async () => {
    if (!repoName.trim()) {
      setError('Please provide a repository name');
      return;
    }

    if (uploadMode === 'path' && !repoPath.trim()) {
      setError('Please provide a repository path or URL');
      return;
    }

    if (uploadMode === 'upload' && uploadedFiles.length === 0) {
      setError('Please upload at least one code file');
      return;
    }

    setStep('scanning');
    setError('');
    setScanProgress(0);
    setScanStatus('Initializing scan...');

    try {
      // Simulate scanning progress
      const progressSteps = [
        { progress: 15, status: 'Reading repository files...' },
        { progress: 30, status: 'Analyzing file structure...' },
        { progress: 50, status: 'Extracting routes and handlers...' },
        { progress: 70, status: 'Mapping component relationships...' },
        { progress: 85, status: 'Identifying data transformations...' },
        { progress: 95, status: 'Generating visualizer schema...' },
      ];

      for (const { progress, status } of progressSteps) {
        await new Promise(resolve => setTimeout(resolve, 800));
        setScanProgress(progress);
        setScanStatus(status);
      }

      let response;

      if (uploadMode === 'upload') {
        // Upload files mode
        const formData = new FormData();
        formData.append('repoName', repoName);
        uploadedFiles.forEach(file => {
          formData.append('files', file);
        });

        response = await fetch('/api/scan-upload', {
          method: 'POST',
          body: formData,
        });
      } else {
        // Path/URL mode
        response = await fetch('/api/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            repoPath, 
            repoName,
            backendUrl: backendUrl || undefined 
          }),
        });
      }

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Scan failed');
      }

      setScanProgress(100);
      setScanStatus('Scan complete! ✓');
      
      await new Promise(resolve => setTimeout(resolve, 500));
      setStep('done');
      
      // Wait a bit then complete
      setTimeout(() => {
        onComplete();
      }, 1500);

    } catch (err: any) {
      console.error('Scan error:', err);
      setError(err.message || 'Failed to scan repository');
      setStep('scan');
    }
  };

  return (
    <div className="flex items-center justify-center h-screen" style={{ background: 'var(--bg1)' }}>
      <div className="w-[600px] border" style={{
        background: 'var(--bg)',
        borderColor: 'var(--border)'
      }}>
        {/* Header */}
        <div className="p-6 border-b" style={{ 
          background: 'var(--bg)', 
          borderColor: 'var(--border)' 
        }}>
          <h1 className="text-xl font-bold mb-1" style={{ color: 'var(--text)' }}>
            TraceLab Setup
          </h1>
          <p className="text-sm" style={{ color: 'var(--text2)' }}>
            Visualize your API request flows
          </p>
        </div>

        {/* Body */}
        <div className="p-6">
          {step === 'name' && (
            <div>
              <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--text)' }}>
                Name Your Repository
              </h2>
              <p className="text-sm mb-6" style={{ color: 'var(--text2)' }}>
                Give your repository a name so we can identify it in the visualizer.
              </p>
              
              <div className="mb-4">
                <label className="block text-xs font-medium mb-2" style={{ color: 'var(--text2)' }}>
                  Repository Name
                </label>
                <input
                  type="text"
                  value={repoName}
                  onChange={e => setRepoName(e.target.value)}
                  placeholder="e.g., my-api-server"
                  className="w-full px-4 py-2 border text-sm"
                  style={{
                    background: 'var(--bg)',
                    borderColor: 'var(--border)',
                    color: 'var(--text)'
                  }}
                />
              </div>

              <button
                onClick={() => setStep('scan')}
                disabled={!repoName.trim()}
                className="w-full px-4 py-2 text-sm font-medium transition-colors"
                style={{
                  background: repoName.trim() ? 'var(--accent)' : 'var(--bg2)',
                  color: repoName.trim() ? '#fff' : 'var(--text3)',
                  cursor: repoName.trim() ? 'pointer' : 'not-allowed',
                  border: 'none'
                }}
              >
                Continue →
              </button>
            </div>
          )}

          {step === 'scan' && (
            <div>
              <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--text)' }}>
                Locate Your Repository
              </h2>
              <p className="text-sm mb-4" style={{ color: 'var(--text2)' }}>
                Provide a local path, GitHub URL, or upload files. We'll use Gemini AI to analyze your code.
              </p>

              {/* Mode Tabs */}
              <div className="flex gap-0 mb-4 border" style={{ borderColor: 'var(--border)' }}>
                <button
                  onClick={() => setUploadMode('path')}
                  className="flex-1 px-4 py-2 text-sm font-medium transition-colors"
                  style={{
                    background: uploadMode === 'path' ? 'var(--accent)' : 'var(--bg)',
                    color: uploadMode === 'path' ? '#fff' : 'var(--text2)',
                    borderRight: '1px solid var(--border)'
                  }}
                >
                  Path / URL
                </button>
                <button
                  onClick={() => setUploadMode('upload')}
                  className="flex-1 px-4 py-2 text-sm font-medium transition-colors"
                  style={{
                    background: uploadMode === 'upload' ? 'var(--accent)' : 'var(--bg)',
                    color: uploadMode === 'upload' ? '#fff' : 'var(--text2)'
                  }}
                >
                  Upload Files
                </button>
              </div>
              
              {uploadMode === 'path' ? (
                <>
                  <div className="mb-4">
                    <label className="block text-xs font-medium mb-2" style={{ color: 'var(--text2)' }}>
                      Repository Source
                    </label>
                    <input
                      type="text"
                      value={repoPath}
                      onChange={e => setRepoPath(e.target.value)}
                      placeholder="./test-server or https://github.com/user/repo"
                      className="w-full px-4 py-2 border text-sm"
                      style={{
                        background: 'var(--bg)',
                        borderColor: 'var(--border)',
                        color: 'var(--text)'
                      }}
                    />
                    <div className="mt-2 space-y-1">
                      <p className="text-xs" style={{ color: 'var(--text3)' }}>
                        • Local: <span className="font-mono">./test-server</span> or <span className="font-mono">/path/to/repo</span>
                      </p>
                      <p className="text-xs" style={{ color: 'var(--text3)' }}>
                        • GitHub: <span className="font-mono">https://github.com/username/repo</span>
                      </p>
                    </div>
                  </div>

                  <div className="mb-4">
                    <label className="block text-xs font-medium mb-2" style={{ color: 'var(--text2)' }}>
                      Backend URL (Optional - for live testing)
                    </label>
                    <input
                      type="text"
                      value={backendUrl}
                      onChange={e => setBackendUrl(e.target.value)}
                      placeholder="https://api.example.com or http://localhost:3000"
                      className="w-full px-4 py-2 border text-sm"
                      style={{
                        background: 'var(--bg)',
                        borderColor: 'var(--border)',
                        color: 'var(--text)'
                      }}
                    />
                    <p className="text-xs mt-2" style={{ color: 'var(--text3)' }}>
                      If provided, we'll use this URL to execute actual requests
                    </p>
                  </div>
                </>
              ) : (
                <div className="mb-4">
                  <label className="block text-xs font-medium mb-2" style={{ color: 'var(--text2)' }}>
                    Upload Repository Files
                  </label>
                  <div 
                    className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-all hover:border-blue-400"
                    style={{
                      borderColor: uploadedFiles.length > 0 ? 'var(--accent)' : 'var(--border3)',
                      background: 'var(--bg1)'
                    }}
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onClick={() => document.getElementById('file-input')?.click()}
                  >
                    <input
                      id="file-input"
                      type="file"
                      multiple
                      accept=".ts,.tsx,.js,.jsx,.rs,.go,.py,.java,.c,.cpp,.h,.hpp"
                      onChange={(e) => handleFileUpload(e.target.files)}
                      style={{ display: 'none' }}
                    />
                    <div className="text-4xl mb-2">📦</div>
                    <p className="text-sm mb-1" style={{ color: 'var(--text)' }}>
                      {uploadedFiles.length > 0 ? `${uploadedFiles.length} files selected` : 'Drag & drop files here'}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text3)' }}>
                      or click to browse
                    </p>
                    <p className="text-xs mt-2" style={{ color: 'var(--text3)' }}>
                      Supports: .ts, .js, .rs, .go, .py, .java, .c, .cpp
                    </p>
                  </div>
                  
                  {uploadedFiles.length > 0 && (
                    <div className="mt-3 max-h-32 overflow-y-auto p-2 rounded border" style={{
                      background: 'var(--bg1)',
                      borderColor: 'var(--border2)'
                    }}>
                      {uploadedFiles.map((file, i) => (
                        <div key={i} className="flex items-center justify-between py-1 text-xs">
                          <span className="font-mono truncate" style={{ color: 'var(--text2)' }}>
                            {file.name}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setUploadedFiles(prev => prev.filter((_, idx) => idx !== i));
                            }}
                            className="ml-2 px-2 py-0.5 rounded hover:bg-red-100"
                            style={{ color: 'var(--red)' }}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="mb-4 p-3 border" style={{
                background: '#dbeafe',
                borderColor: '#93c5fd'
              }}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold" style={{ color: '#1e40af' }}>
                    Powered by Gemini 1.5 Pro
                  </span>
                </div>
                <p className="text-xs" style={{ color: '#1e3a8a' }}>
                  AI will analyze routes, handlers, services, and data flows
                </p>
              </div>

              {error && (
                <div className="mb-4 p-3 border" style={{
                  background: '#fee2e2',
                  borderColor: '#fca5a5',
                  color: '#991b1b'
                }}>
                  <p className="text-xs font-semibold mb-1">Error</p>
                  <p className="text-xs">{error}</p>
                </div>
              )}

              <div className="flex gap-0 border-t" style={{ borderColor: 'var(--border)', marginLeft: '-24px', marginRight: '-24px', marginBottom: '-24px' }}>
                <button
                  onClick={() => setStep('name')}
                  className="px-6 py-3 text-sm font-medium border-r transition-colors hover:bg-gray-50"
                  style={{
                    background: 'var(--bg)',
                    borderColor: 'var(--border)',
                    color: 'var(--text2)'
                  }}
                >
                  ← Back
                </button>
                <button
                  onClick={handleStartScan}
                  disabled={(uploadMode === 'path' && !repoPath.trim()) || (uploadMode === 'upload' && uploadedFiles.length === 0)}
                  className="flex-1 px-6 py-3 text-sm font-medium transition-colors"
                  style={{
                    background: ((uploadMode === 'path' && repoPath.trim()) || (uploadMode === 'upload' && uploadedFiles.length > 0)) ? 'var(--accent)' : 'var(--bg2)',
                    color: ((uploadMode === 'path' && repoPath.trim()) || (uploadMode === 'upload' && uploadedFiles.length > 0)) ? '#fff' : 'var(--text3)',
                    cursor: ((uploadMode === 'path' && repoPath.trim()) || (uploadMode === 'upload' && uploadedFiles.length > 0)) ? 'pointer' : 'not-allowed',
                    border: 'none'
                  }}
                >
                  Scan with Gemini AI
                </button>
              </div>
            </div>
          )}

          {step === 'scanning' && (
            <div>
              <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--text)' }}>
                Scanning {repoName}...
              </h2>
              
              <div className="mb-6">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{
                    borderColor: 'var(--accent)',
                    borderTopColor: 'transparent'
                  }}></div>
                  <p className="text-sm font-mono" style={{ color: 'var(--text2)' }}>
                    {scanStatus}
                  </p>
                </div>
                
                <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg3)' }}>
                  <div 
                    className="h-full transition-all duration-500"
                    style={{ 
                      width: `${scanProgress}%`,
                      background: 'linear-gradient(90deg, var(--accent), var(--purple))'
                    }}
                  ></div>
                </div>
                
                <p className="text-xs mt-2 text-right font-mono" style={{ color: 'var(--text3)' }}>
                  {scanProgress}%
                </p>
              </div>

              <div className="p-4 rounded-lg border" style={{
                background: 'var(--bg2)',
                borderColor: 'var(--border)'
              }}>
                <p className="text-xs" style={{ color: 'var(--text3)' }}>
                  This may take a minute depending on repository size...
                </p>
              </div>
            </div>
          )}

          {step === 'done' && (
            <div className="text-center py-8">
              <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center" style={{
                background: 'var(--green-glow)',
                border: '2px solid var(--green)'
              }}>
                <span className="text-2xl">✓</span>
              </div>
              <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--green)' }}>
                Scan Complete!
              </h2>
              <p className="text-sm" style={{ color: 'var(--text2)' }}>
                Loading visualizer...
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
