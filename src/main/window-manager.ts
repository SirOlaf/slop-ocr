import { BrowserWindow, screen } from 'electron';
import { execSync } from 'child_process';
import * as path from 'path';
import { OCRData, WindowBounds } from './ocr-bridge';

export class WindowManager {
  private overlayWindow: BrowserWindow | null = null;
  private currentBounds: WindowBounds | null = null;
  private targetPID: number | null = null;
  private previousPID: number | null = null;

  createOverlay(): BrowserWindow {
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      return this.overlayWindow;
    }

    this.overlayWindow = new BrowserWindow({
      width: 800,
      height: 600,
      transparent: true,
      frame: false,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      focusable: true,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '../preload/preload.js')
      }
    });

    // Load the overlay HTML
    this.overlayWindow.loadFile(path.join(__dirname, '../renderer/overlay/index.html'));

    // Only log overlay errors
    this.overlayWindow.webContents.on('console-message', (_event, level, message) => {
      if (level >= 3 && !message.includes('Electron Security Warning')) {
        console.log(`[Overlay Error] ${message}`);
      }
    });

    // Make clicks pass through transparent areas
    this.overlayWindow.setIgnoreMouseEvents(false);

    return this.overlayWindow;
  }

  positionOverlay(bounds: WindowBounds): void {
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) {
      return;
    }

    this.currentBounds = bounds;

    // SCContentFilter.contentRect uses top-left origin (Core Graphics coordinates)
    // which matches Electron's coordinate system - no conversion needed
    console.log('positionOverlay:', {
      bounds,
      finalBounds: {
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height)
      }
    });

    this.overlayWindow.setBounds({
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height)
    });
  }

  setTargetPID(pid: number | null): void {
    this.targetPID = pid;
  }

  setPreviousPID(pid: number | null): void {
    this.previousPID = pid;
  }

  showOverlay(): void {
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      this.overlayWindow.show();
    }
  }

  hideOverlay(): void {
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      this.overlayWindow.hide();
    }
  }

  private getProcessGroupID(pid: number): number | null {
    try {
      const result = execSync(`ps -o pgid= -p ${pid}`, { timeout: 1000 }).toString().trim();
      return parseInt(result) || null;
    } catch {
      return null;
    }
  }

  focusPreviousIfTarget(): void {
    if (!this.previousPID || !this.targetPID) return;

    const previousPGID = this.getProcessGroupID(this.previousPID);
    const targetPGID = this.getProcessGroupID(this.targetPID);

    if (previousPGID !== null && previousPGID === targetPGID) {
      try {
        execSync(
          `osascript -e 'tell application "System Events" to set frontmost of first process whose unix id is ${this.previousPID} to true'`,
          { timeout: 2000 }
        );
      } catch {
        // Ignore activation errors
      }
    }
  }

  toggleOverlay(): void {
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      if (this.overlayWindow.isVisible()) {
        this.hideOverlay();
      } else {
        this.showOverlay();
      }
    }
  }

  updateOCRResults(data: OCRData): void {
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      this.overlayWindow.webContents.send('ocr-results', data);
    }
  }

  setLoadingState(isLoading: boolean): void {
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      this.overlayWindow.webContents.send('ocr-loading', isLoading);
    }
  }

  showError(message: string): void {
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      this.overlayWindow.webContents.send('ocr-error', message);
    }
  }

  getOverlayWindow(): BrowserWindow | null {
    return this.overlayWindow;
  }

  getCurrentBounds(): WindowBounds | null {
    return this.currentBounds;
  }

  destroy(): void {
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      this.overlayWindow.destroy();
      this.overlayWindow = null;
    }
  }
}
