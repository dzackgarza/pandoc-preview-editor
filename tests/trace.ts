import {
  writeFileSync,
  mkdirSync,
  appendFileSync,
  existsSync,
  readFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

// ============================================================
// Trace: structured JSONL witness for certification tests
// ============================================================

export interface TraceEvent {
  event: string;
  test?: string;
  [key: string]: unknown;
}

export class TraceContext {
  private dir: string;
  private path: string;
  private events: TraceEvent[] = [];
  private bufferVersion = 0;
  private lastBufferHash = '';

  constructor(testName: string, artifactsRoot = 'test-artifacts') {
    this.dir = join(artifactsRoot, testName);
    mkdirSync(this.dir, { recursive: true });
    this.path = join(this.dir, 'trace.jsonl');
  }

  record(ev: TraceEvent): void {
    this.events.push(ev);
    appendFileSync(this.path, JSON.stringify(ev) + '\n', 'utf-8');
  }

  // File path for saving artifacts alongside the trace
  artifactPath(name: string): string {
    return join(this.dir, name);
  }

  writeArtifact(name: string, content: string): void {
    writeFileSync(join(this.dir, name), content, 'utf-8');
  }

  readArtifact(name: string): string {
    return readFileSync(join(this.dir, name), 'utf-8');
  }

  /** Record a buffer read with auto-incrementing version */
  recordBufferRead(
    content: string,
    sha256: string,
  ): { version: number; sha256: string } {
    this.bufferVersion++;
    const ev: TraceEvent = {
      event: 'nvim.buffer.read',
      version: this.bufferVersion,
      sha256,
      bytes: content.length,
    };
    this.record(ev);
    this.lastBufferHash = sha256;
    return { version: this.bufferVersion, sha256 };
  }

  /** Record pandoc render success, linked to the last buffer version */
  recordRenderSuccess(htmlSha256: string): void {
    this.record({
      event: 'pandoc.render.success',
      sourceVersion: this.bufferVersion,
      sourceSha256: this.lastBufferHash,
      htmlSha256,
    });
  }

  /** Record preview DOM update, linked to the last buffer version */
  recordPreviewUpdated(bodyTextSha256: string): void {
    this.record({
      event: 'preview.dom.updated',
      sourceVersion: this.bufferVersion,
      sourceSha256: this.lastBufferHash,
      bodyTextSha256,
    });
  }

  /** Record save start */
  recordSaveStart(): void {
    this.record({
      event: 'save.start',
      requiredSourceVersion: this.bufferVersion,
    });
  }

  /** Record save success */
  recordSaveSuccess(diskContent: string): void {
    this.record({
      event: 'save.success',
      savedVersion: this.bufferVersion,
      diskSha256: sha256short(diskContent),
      bytes: diskContent.length,
    });
  }

  get lastVersion(): number {
    return this.bufferVersion;
  }
  get lastHash(): string {
    return this.lastBufferHash;
  }

  /** Write initial file artifact */
  writeInitialFile(path: string, content: string): void {
    this.writeArtifact('initial.md', content);
    this.record({
      event: 'artifact.initial.md',
      path,
      sha256: sha256short(content),
      bytes: content.length,
    });
  }

  /** Write final file artifact */
  writeFinalFile(path: string, content: string): void {
    this.writeArtifact('final.md', content);
    this.record({
      event: 'artifact.final.md',
      path,
      sha256: sha256short(content),
      bytes: content.length,
    });
  }

  /** Write preview HTML artifact */
  writePreviewHtml(html: string): void {
    this.writeArtifact('preview.html', html);
    this.record({
      event: 'artifact.preview.html',
      bytes: html.length,
      sha256: sha256short(html),
    });
  }

  /** Write stdout log artifact */
  writeStdout(log: string): void {
    this.writeArtifact('stdout.log', log);
  }

  /** Write stderr log artifact */
  writeStderr(log: string): void {
    this.writeArtifact('stderr.log', log);
  }

  // Process tree capture: runs ps and writes to process-tree.txt
  captureProcessTree(): string {
    const out = spawnSync('ps', ['auxf', '--forest'], {
      encoding: 'utf-8',
      timeout: 3000,
    });
    const text = out.stdout || '';
    this.writeArtifact('process-tree.txt', text);
    return text;
  }

  // Capture a specific PID's ancestry
  capturePidAncestry(pid: number): string {
    const out = spawnSync('ps', ['-p', String(pid), '-o', 'pid,ppid,comm,args'], {
      encoding: 'utf-8',
      timeout: 3000,
    });
    const text = out.stdout || '';
    this.writeArtifact(`pid-${pid}.txt`, text);
    return text;
  }

  dirPath(): string {
    return this.dir;
  }

  getEvents(): TraceEvent[] {
    return [...this.events];
  }

  // ============================================================
  // Trace assertion helpers
  // ============================================================

  static assertTraceVersionOrder(
    trace: TraceContext,
    expectFn: (actual: unknown, matcher: unknown, msg?: string) => void,
    message: string,
  ): void {
    const events = trace.getEvents();

    const bufferReads = events
      .filter((e) => e.event === 'nvim.buffer.read')
      .map((e) => ({ index: events.indexOf(e), version: e.version as number }));

    const renderSuccesses = events
      .filter((e) => e.event === 'pandoc.render.success')
      .map((e) => ({
        index: events.indexOf(e),
        sourceVersion: e.sourceVersion as number,
      }));

    const previewUpdates = events
      .filter((e) => e.event === 'preview.dom.updated')
      .map((e) => ({
        index: events.indexOf(e),
        sourceVersion: e.sourceVersion as number,
      }));

    for (const render of renderSuccesses) {
      const matchingRead = bufferReads.find((r) => r.version === render.sourceVersion);
      expectFn(
        matchingRead,
        true,
        `${message}: pandoc.render.success(v=${render.sourceVersion}) must have preceding nvim.buffer.read(v=${render.sourceVersion})`,
      );
      expectFn(
        matchingRead!.index,
        render.index,
        `${message}: nvim.buffer.read(v=${render.sourceVersion}) must precede pandoc.render.success`,
      );
    }

    for (const preview of previewUpdates) {
      const matchingRender = renderSuccesses.find(
        (r) => r.sourceVersion === preview.sourceVersion,
      );
      expectFn(
        matchingRender,
        true,
        `${message}: preview.dom.updated(v=${preview.sourceVersion}) must have preceding pandoc.render.success(v=${preview.sourceVersion})`,
      );
      expectFn(
        matchingRender!.index,
        preview.index,
        `${message}: pandoc.render.success(v=${preview.sourceVersion}) must precede preview.dom.updated`,
      );
    }
  }

  static assertSaveInvariant(
    trace: TraceContext,
    expectFn: (actual: unknown, matcher: unknown, msg?: string) => void,
    message: string,
  ): void {
    const events = trace.getEvents();

    const bufferReads = events
      .filter((e) => e.event === 'nvim.buffer.read')
      .map((e) => ({ index: events.indexOf(e), version: e.version as number }));

    const saveSuccesses = events
      .filter((e) => e.event === 'save.success')
      .map((e) => ({
        index: events.indexOf(e),
        savedVersion: e.savedVersion as number,
      }));

    for (const save of saveSuccesses) {
      const matchingRead = bufferReads.find((r) => r.version === save.savedVersion);
      expectFn(
        matchingRead,
        true,
        `${message}: save.success(v=${save.savedVersion}) requires nvim.buffer.read(v=${save.savedVersion})`,
      );
      expectFn(
        matchingRead!.index,
        save.index,
        `${message}: nvim.buffer.read(v=${save.savedVersion}) must precede save.success`,
      );
    }
  }

  // ============================================================
  // Module-level trace assertion helpers
  // ============================================================

  static traceHas(trace: TraceContext, eventName: string): boolean {
    return trace.getEvents().some((e) => e.event === eventName);
  }

  static traceOrder(trace: TraceContext, ...eventNames: string[]): boolean {
    const events = trace.getEvents().map((e) => e.event);
    let pos = 0;
    for (const name of eventNames) {
      pos = events.indexOf(name, pos);
      if (pos === -1) return false;
      pos++;
    }
    return true;
  }

  static traceNoEvent(trace: TraceContext, eventName: string): boolean {
    return !TraceContext.traceHas(trace, eventName);
  }

  static traceEventsOf(trace: TraceContext, eventName: string): TraceEvent[] {
    return trace.getEvents().filter((e) => e.event === eventName);
  }
}

// ============================================================
// Module-level trace assertion helpers
// ============================================================

export function traceHas(trace: TraceContext, eventName: string): boolean {
  return trace.getEvents().some((e) => e.event === eventName);
}

export function traceOrder(trace: TraceContext, ...eventNames: string[]): boolean {
  const events = trace.getEvents().map((e) => e.event);
  let pos = 0;
  for (const name of eventNames) {
    pos = events.indexOf(name, pos);
    if (pos === -1) return false;
    pos++;
  }
  return true;
}

export function traceNoEvent(trace: TraceContext, eventName: string): boolean {
  return !traceHas(trace, eventName);
}

export function traceEventsOf(trace: TraceContext, eventName: string): TraceEvent[] {
  return trace.getEvents().filter((e) => e.event === eventName);
}

// ============================================================
// Version-aware trace assertion helpers
// ============================================================

export function assertTraceVersionOrder(
  trace: TraceContext,
  expectFn: (actual: unknown, matcher: unknown, msg?: string) => void,
  message: string,
): void {
  TraceContext.assertTraceVersionOrder(trace, expectFn, message);
}

export function assertSaveInvariant(
  trace: TraceContext,
  expectFn: (actual: unknown, matcher: unknown, msg?: string) => void,
  message: string,
): void {
  TraceContext.assertSaveInvariant(trace, expectFn, message);
}

// ============================================================
// Utility
// ============================================================

export function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function sha256short(content: string): string {
  return sha256(content).slice(0, 12);
}
