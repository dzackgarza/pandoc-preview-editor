import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Image, Globe, Monitor, Loader, Clipboard, Plus, Check } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { blobToBase64 } from '../lib/utils.js';
import { DIAGRAM_TOOLS, type DiagramTool } from '../../shared/diagram-tools.js';

interface DiagramModalProps {
  open: boolean;
  onClose: () => void;
  ensureRealFile: () => Promise<string | null>;
  insertTextAtCursor: (text: string) => void;
}

type TabType = 'clipboard' | 'web' | 'desktop';

export function DiagramModal({
  open,
  onClose,
  ensureRealFile,
  insertTextAtCursor,
}: DiagramModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>('clipboard');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Desktop form states — tool id is a plain string; the DIAGRAM_TOOLS registry
  // is the source of truth for which ids exist and what they mean.
  const [desktopTool, setDesktopTool] = useState<string>(DIAGRAM_TOOLS[0].id);
  const [filename, setFilename] = useState('');
  // Optimistic defaults: treat every tool as available until the server says otherwise.
  const [availableTools, setAvailableTools] = useState<Record<string, boolean>>(
    Object.fromEntries(DIAGRAM_TOOLS.map((t: DiagramTool) => [t.id, true])),
  );

  useEffect(() => {
    if (open) {
      invoke<Record<string, boolean>>('get_diagram_tools')
        .then((data) => {
          if (data) {
            setAvailableTools(data);
            if (!data[desktopTool]) {
              const firstAvailable = DIAGRAM_TOOLS.find((t: DiagramTool) => data[t.id]);
              if (firstAvailable) setDesktopTool(firstAvailable.id);
            }
          }
        })
        .catch(console.error);
    }
  }, [open]);

  // Web tools states
  const [webTool, setWebTool] = useState<'quiver' | 'freetikz'>('quiver');
  const [proxyHtml, setProxyHtml] = useState('');
  const [proxyLoading, setProxyLoading] = useState(false);

  const webToolUrl =
    webTool === 'quiver'
      ? 'https://q.uiver.app/'
      : 'https://homepages.inf.ed.ac.uk/cheunen/freetikz/freetikz.html';

  useEffect(() => {
    let active = true;
    if (open && activeTab === 'web') {
      setProxyLoading(true);
      invoke<{ html: string }>('diagram_proxy', { url: webToolUrl })
        .then((data) => {
          if (active) {
            setProxyHtml(data.html);
          }
        })
        .catch(console.error)
        .finally(() => {
          if (active) {
            setProxyLoading(false);
          }
        });
    }
    return () => {
      active = false;
    };
  }, [open, activeTab, webToolUrl]);

  // Clipboard preview state
  const [clipboardImage, setClipboardImage] = useState<string | null>(null);
  const [clipboardBlob, setClipboardBlob] = useState<Blob | null>(null);

  // Listen to same-origin web tool postMessage exports
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'diagram-export') {
        const code = event.data.code;
        insertTextAtCursor(`\n${code}\n`);
        onClose();
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [insertTextAtCursor, onClose]);

  // Read image from clipboard on mount/tab change
  useEffect(() => {
    if (open && activeTab === 'clipboard') {
      checkClipboard();
    } else {
      setClipboardImage(null);
      setClipboardBlob(null);
    }
  }, [open, activeTab]);

  const checkClipboard = async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        for (const type of item.types) {
          if (type.startsWith('image/')) {
            const blob = await item.getType(type);
            setClipboardBlob(blob);
            const reader = new FileReader();
            reader.onloadend = () => {
              setClipboardImage(reader.result as string);
            };
            reader.readAsDataURL(blob);
            return;
          }
        }
      }
      setClipboardImage(null);
      setClipboardBlob(null);
    } catch {
      // Clipboard read API blocked or empty
      setClipboardImage(null);
      setClipboardBlob(null);
    }
  };

  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = (reader.result as string).split(',')[1];
        resolve(base64String);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const handleInsertClipboard = async () => {
    if (!clipboardBlob) return;
    setLoading(true);
    setError(null);
    try {
      const docPath = await ensureRealFile();
      if (!docPath) {
        setLoading(false);
        return;
      }

      const contentBase64 = await blobToBase64(clipboardBlob);
      const data = await invoke<{
        ok: boolean;
        path: string;
        relativePath: string;
        markdown: string;
      }>('save_figure_asset', {
        contentBase64,
        documentPath: docPath,
        mimeType: clipboardBlob.type,
      });

      if (!data.ok) {
        throw new Error('Failed to save clipboard image');
      }
      insertTextAtCursor(`\n${data.markdown}\n`);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Clipboard save failed');
    } finally {
      setLoading(false);
    }
  };

  const handleLaunchDesktop = async () => {
    if (!filename.trim()) {
      setError('Please specify a filename');
      return;
    }
    setLoading(true);
    setError(null);

    const activeTool =
      DIAGRAM_TOOLS.find((t: DiagramTool) => t.id === desktopTool) ?? DIAGRAM_TOOLS[0];
    const ext = activeTool.ext;

    let finalName = filename.trim();
    if (!finalName.endsWith(ext)) {
      finalName += ext;
    }

    try {
      const docPath = await ensureRealFile();
      if (!docPath) {
        setLoading(false);
        return;
      }

      const fileData = await invoke<{
        ok: boolean;
        absolutePath: string;
        relativePath: string;
      }>('create_diagram_file', {
        kind: desktopTool,
        filename: finalName,
        documentPath: docPath,
      });

      if (!fileData.ok) {
        throw new Error('Failed to create diagram template file');
      }

      await invoke('launch_diagram', {
        absolutePath: fileData.absolutePath,
        kind: desktopTool,
      });

      const activeTool =
        DIAGRAM_TOOLS.find((t: DiagramTool) => t.id === desktopTool) ??
        DIAGRAM_TOOLS[0];
      const markdownRef = activeTool.markdownRef(finalName);

      insertTextAtCursor(`\n${markdownRef}\n`);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Desktop launching failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(val) => {
        if (!val) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs transition-opacity" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[800px] h-[600px] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[#2b2f38] bg-[#1e222b] text-[#e6e8eb] shadow-2xl outline-none flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[#2b2f38] px-4 py-3 shrink-0">
            <div className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-[#89b4fa]" />
              <Dialog.Title className="text-base font-medium">
                Insert Diagram / Figure
              </Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <button
                aria-label="Close"
                className="rounded p-1 hover:bg-[#303541] hover:text-white cursor-pointer transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          {/* Navigation Bar */}
          <div className="flex bg-[#171a21] border-b border-[#2b2f38] shrink-0">
            <button
              onClick={() => {
                setActiveTab('clipboard');
                setError(null);
              }}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 outline-none transition-all cursor-pointer ${
                activeTab === 'clipboard'
                  ? 'border-[#89b4fa] text-white bg-[#1e222b]/55'
                  : 'border-transparent text-[#788190] hover:text-[#e6e8eb] hover:bg-[#1e222b]/30'
              }`}
            >
              <Clipboard className="h-4 w-4" />
              From Clipboard
            </button>
            <button
              onClick={() => {
                setActiveTab('web');
                setError(null);
              }}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 outline-none transition-all cursor-pointer ${
                activeTab === 'web'
                  ? 'border-[#89b4fa] text-white bg-[#1e222b]/55'
                  : 'border-transparent text-[#788190] hover:text-[#e6e8eb] hover:bg-[#1e222b]/30'
              }`}
            >
              <Globe className="h-4 w-4" />
              Web TikZ Tools
            </button>
            <button
              onClick={() => {
                setActiveTab('desktop');
                setError(null);
              }}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 outline-none transition-all cursor-pointer ${
                activeTab === 'desktop'
                  ? 'border-[#89b4fa] text-white bg-[#1e222b]/55'
                  : 'border-transparent text-[#788190] hover:text-[#e6e8eb] hover:bg-[#1e222b]/30'
              }`}
            >
              <Monitor className="h-4 w-4" />
              Desktop App Integration
            </button>
          </div>

          {/* Body content */}
          <div className="flex-1 overflow-hidden flex flex-col p-4">
            {error && (
              <div className="rounded border border-[#e06c75]/20 bg-[#e06c75]/10 p-3 text-xs text-[#e06c75] mb-3 shrink-0">
                {error}
              </div>
            )}

            {/* Clipboard Tab */}
            {activeTab === 'clipboard' && (
              <div className="flex-1 flex flex-col justify-center items-center gap-4 text-center">
                {clipboardImage ? (
                  <div className="flex flex-col items-center gap-4 max-w-md w-full">
                    <div className="text-xs text-[#788190]">
                      Detected image on clipboard:
                    </div>
                    <div className="relative rounded-lg border border-[#343946] bg-[#15161a] p-2 max-h-60 overflow-hidden shadow-inner flex items-center justify-center">
                      <img
                        src={clipboardImage}
                        alt="Clipboard content"
                        className="max-h-56 max-w-full object-contain rounded-md"
                      />
                    </div>
                    <button
                      onClick={handleInsertClipboard}
                      disabled={loading}
                      className="rounded bg-[#89b4fa] text-[#11111b] px-6 py-2.5 text-sm font-semibold hover:bg-[#b4befe] transition-all cursor-pointer flex items-center gap-1.5 shadow-md disabled:opacity-40"
                    >
                      {loading ? (
                        <Loader className="h-4 w-4 animate-spin text-[#11111b]" />
                      ) : (
                        <Image className="h-4 w-4 text-[#11111b]" />
                      )}
                      Insert Clipboard Image
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 max-w-sm text-[#788190]">
                    <Clipboard className="h-10 w-10 text-[#5c6370] mb-2" />
                    <span className="text-sm font-semibold text-[#d6d9df]">
                      No Image Found on Clipboard
                    </span>
                    <span className="text-xs">
                      Copy an image (screenshot or diagram export) onto your system
                      clipboard, click the button below to scan, and insert it
                      instantly.
                    </span>
                    <button
                      onClick={checkClipboard}
                      className="mt-3 rounded border border-[#343946] bg-[#222530] px-4 py-2 text-xs text-[#aab2c0] hover:bg-[#2b2e3c] transition-colors cursor-pointer"
                    >
                      Scan Clipboard Again
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Web Tools Tab */}
            {activeTab === 'web' && (
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="flex justify-between items-center pb-2 shrink-0">
                  <div className="text-xs text-[#788190]">
                    Serve quiver or FreeTikZ same-origin. Export actions inside the tool
                    are intercepted and automatically injected at the cursor.
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setWebTool('quiver')}
                      className={`px-3 py-1 text-xs rounded transition-all cursor-pointer ${
                        webTool === 'quiver'
                          ? 'bg-[#89b4fa] text-[#11111b] font-semibold'
                          : 'bg-[#303541] text-[#b9c0cc] hover:bg-[#3a4050]'
                      }`}
                    >
                      quiver (Commutative Diagrams)
                    </button>
                    <button
                      onClick={() => setWebTool('freetikz')}
                      className={`px-3 py-1 text-xs rounded transition-all cursor-pointer ${
                        webTool === 'freetikz'
                          ? 'bg-[#89b4fa] text-[#11111b] font-semibold'
                          : 'bg-[#303541] text-[#b9c0cc] hover:bg-[#3a4050]'
                      }`}
                    >
                      FreeTikZ (LaTeX Draw Tool)
                    </button>
                  </div>
                </div>

                <div className="flex-1 rounded-lg border border-[#2b2f38] bg-black overflow-hidden relative shadow-inner">
                  {proxyLoading ? (
                    <div className="flex h-full items-center justify-center text-[#788190] text-xs">
                      <Loader className="h-5 w-5 animate-spin mr-2" />
                      Loading...
                    </div>
                  ) : (
                    <iframe
                      srcDoc={proxyHtml}
                      className="w-full h-full border-none"
                      title="Web TikZ Tool"
                    />
                  )}
                </div>
              </div>
            )}

            {/* Desktop Tools Tab */}
            {activeTab === 'desktop' && (
              <div className="flex-1 flex flex-col justify-center items-center">
                <div className="max-w-md w-full flex flex-col gap-4">
                  <div className="text-xs text-[#788190] text-center">
                    Select a local desktop vector/diagram app. The server will
                    instantiate a starter file template inside your document's
                    `./figures/` folder, launch the app, and insert a relative link
                    automatically.
                  </div>

                  <div className="grid grid-cols-2 gap-2 mt-2">
                    {DIAGRAM_TOOLS.map((tool: DiagramTool) => {
                      const isAvailable = availableTools[tool.id];
                      if (!isAvailable) {
                        return (
                          <a
                            key={tool.id}
                            href={tool.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded-md border p-3 text-left transition-all border-[#e06c75]/25 bg-[#e06c75]/5 text-[#e06c75] hover:bg-[#e06c75]/10 cursor-pointer block hover:no-underline"
                          >
                            <div className="text-sm font-semibold flex items-center gap-1.5 justify-between">
                              <span>{tool.label}</span>
                              <span className="text-[9px] font-normal px-1.5 py-0.5 rounded bg-[#2b1c1e] text-[#f38ba8] border border-[#f38ba8]/20 whitespace-nowrap">
                                Install (Link)
                              </span>
                            </div>
                            <div className="text-xs text-[#aab2c8] mt-0.5">
                              {tool.desc}
                            </div>
                            <div className="text-[10px] text-[#e06c75] underline mt-1.5">
                              Visit homepage to install &rarr;
                            </div>
                          </a>
                        );
                      }
                      return (
                        <button
                          key={tool.id}
                          onClick={() => {
                            setDesktopTool(tool.id);
                            setError(null);
                          }}
                          className={`rounded-md border p-3 text-left transition-all ${
                            desktopTool === tool.id
                              ? 'border-[#89b4fa] bg-[#89b4fa]/5 text-white cursor-pointer'
                              : 'border-[#2b2f38] bg-[#171a21]/50 text-[#788190] hover:bg-[#20242e] hover:text-[#e6e8eb] cursor-pointer'
                          }`}
                        >
                          <div className="text-sm font-semibold">{tool.label}</div>
                          <div className="text-xs text-[#5c6370] mt-0.5">
                            {tool.desc}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex flex-col gap-1.5 mt-2">
                    <label className="text-xs font-semibold text-[#a9b2c3]">
                      Figure Filename
                    </label>
                    <input
                      type="text"
                      className="w-full rounded border border-[#343946] bg-[#15161a] px-3 py-2 text-sm text-[#e6e8eb] outline-none focus:border-[#89b4fa]"
                      placeholder="e.g. commutative-diagram"
                      value={filename}
                      onChange={(e) => setFilename(e.target.value)}
                    />
                    <div className="text-xs text-[#5c6370] font-mono">
                      Will create:{' '}
                      <span className="text-[#aab2c0]">
                        figures/{filename || 'filename'}
                        {
                          (
                            DIAGRAM_TOOLS.find(
                              (t: DiagramTool) => t.id === desktopTool,
                            ) ?? DIAGRAM_TOOLS[0]
                          ).ext
                        }
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={handleLaunchDesktop}
                    disabled={loading || !filename.trim()}
                    className="mt-2 rounded bg-[#89b4fa] text-[#11111b] py-2.5 text-sm font-semibold hover:bg-[#b4befe] transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-md disabled:opacity-40"
                  >
                    {loading ? (
                      <Loader className="h-4 w-4 animate-spin text-[#11111b]" />
                    ) : (
                      <Monitor className="h-4 w-4 text-[#11111b]" />
                    )}
                    Create & Launch App
                  </button>
                </div>
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
