import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as path from 'path';
import { app } from 'electron';
import * as fs from 'fs';

// Response types from Swift CLI
export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextObservation {
  text: string;
  confidence: number;
  boundingBox: { x: number; y: number; width: number; height: number };
  topLeft: { x: number; y: number };
  topRight: { x: number; y: number };
  bottomRight: { x: number; y: number };
  bottomLeft: { x: number; y: number };
}

export interface OCRData {
  imageWidth: number;
  imageHeight: number;
  observations: TextObservation[];
  bounds?: WindowBounds;  // Included when scan triggers a pick
}

export interface WindowSelectedData {
  windowId: number | null;
  appName: string | null;
  windowTitle: string | null;
  bounds: WindowBounds | null;
}

export interface CLIResponse {
  type: string;
  success: boolean;
  data?: {
    version?: string;
    windowId?: number;
    appName?: string;
    windowTitle?: string;
    bounds?: WindowBounds;
    imageWidth?: number;
    imageHeight?: number;
    observations?: TextObservation[];
  };
  error?: string;
}

export class OCRBridge extends EventEmitter {
  private process: ChildProcess | null = null;
  private buffer: string = '';
  private ready: boolean = false;
  private cliPath: string;

  constructor(cliPath?: string) {
    super();
    if (cliPath) {
      this.cliPath = cliPath;
    } else {
      // Try packaged app location first, then development location
      const packagedPath = path.join(process.resourcesPath, 'ocrcli');
      const devPath = path.join(__dirname, '../../build/ocrcli');

      if (fs.existsSync(packagedPath)) {
        this.cliPath = packagedPath;
      } else {
        this.cliPath = devPath;
      }
    }
    console.log('OCR CLI path:', this.cliPath);
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.process = spawn(this.cliPath, [], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      this.process.stdout?.on('data', (data: Buffer) => {
        this.buffer += data.toString();
        this.processBuffer();
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        console.error('OCR CLI stderr:', data.toString());
      });

      this.process.on('error', (err) => {
        this.emit('error', err);
        reject(err);
      });

      this.process.on('close', (code) => {
        this.ready = false;
        this.emit('close', code);
      });

      // Wait for ready message
      const onReady = (response: CLIResponse) => {
        if (response.type === 'ready') {
          this.ready = true;
          this.removeListener('response', onReady);
          resolve();
        }
      };
      this.on('response', onReady);

      // Timeout after 5 seconds
      setTimeout(() => {
        if (!this.ready) {
          reject(new Error('CLI did not become ready in time'));
        }
      }, 5000);
    });
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.trim()) {
        try {
          const response = JSON.parse(line) as CLIResponse;
          this.emit('response', response);
        } catch (e) {
          console.error('Failed to parse CLI response:', line);
        }
      }
    }
  }

  private sendCommand(command: object): void {
    if (!this.process?.stdin) {
      throw new Error('CLI not started');
    }
    this.process.stdin.write(JSON.stringify(command) + '\n');
  }

  pick(): Promise<WindowSelectedData> {
    return new Promise((resolve, reject) => {
      // Timeout for picker (60 seconds - user may take time to choose)
      const timeout = setTimeout(() => {
        this.removeListener('response', handler);
        reject(new Error('Window selection timed out'));
      }, 60000);

      const handler = (response: CLIResponse) => {
        if (response.type === 'pick') {
          clearTimeout(timeout);
          this.removeListener('response', handler);
          if (response.success && response.data) {
            resolve({
              windowId: response.data.windowId ?? null,
              appName: response.data.appName ?? null,
              windowTitle: response.data.windowTitle ?? null,
              bounds: response.data.bounds ?? null
            });
          } else {
            reject(new Error(response.error || 'Pick failed'));
          }
        }
      };
      this.on('response', handler);
      this.sendCommand({ action: 'pick' });
    });
  }

  scan(options?: { saveTo?: string; languages?: string[] }): Promise<OCRData> {
    return new Promise((resolve, reject) => {
      // Timeout for scan operation (30 seconds)
      const timeout = setTimeout(() => {
        this.removeListener('response', handler);
        reject(new Error('OCR scan timed out'));
      }, 30000);

      const handler = (response: CLIResponse) => {
        if (response.type === 'scan' || response.type === 'pick') {
          // If we get a pick response first (no window selected), wait for scan
          if (response.type === 'pick') {
            if (!response.success) {
              clearTimeout(timeout);
              this.removeListener('response', handler);
              reject(new Error(response.error || 'Window selection cancelled'));
            }
            return;
          }

          clearTimeout(timeout);
          this.removeListener('response', handler);
          if (response.success && response.data) {
            resolve({
              imageWidth: response.data.imageWidth!,
              imageHeight: response.data.imageHeight!,
              observations: response.data.observations || [],
              bounds: response.data.bounds  // Now always included in scan response
            });
          } else {
            reject(new Error(response.error || 'Scan failed'));
          }
        }
      };
      this.on('response', handler);
      this.sendCommand({ action: 'scan', ...options });
    });
  }

  quit(): void {
    this.sendCommand({ action: 'quit' });
  }

  stop(): void {
    if (this.process) {
      this.quit();
      this.process.kill();
      this.process = null;
    }
  }

  isReady(): boolean {
    return this.ready;
  }
}
