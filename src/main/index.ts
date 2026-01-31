import { app, globalShortcut, ipcMain, session, BrowserWindow, webContents, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { OCRBridge } from './ocr-bridge';
import { WindowManager } from './window-manager';

let ocrBridge: OCRBridge;
let windowManager: WindowManager;
let yomitanExtension: Electron.Extension | null = null;
let settingsWindow: BrowserWindow | null = null;
let backendWindow: BrowserWindow | null = null;

async function loadYomitanExtension() {
  // Try packaged app location first (unpacked from asar), then development location
  let extensionPath = path.join(__dirname, '../../yomitan-chrome');

  // In packaged app, unpacked resources are in app.asar.unpacked
  const unpackedPath = path.join(app.getAppPath() + '.unpacked', 'yomitan-chrome');
  if (fs.existsSync(unpackedPath)) {
    extensionPath = unpackedPath;
  }

  console.log('Loading extension from:', extensionPath);

  // Check if path exists
  if (!fs.existsSync(extensionPath)) {
    console.error('Extension path does not exist:', extensionPath);
    return null;
  }
  if (!fs.existsSync(path.join(extensionPath, 'manifest.json'))) {
    console.error('manifest.json not found in extension path');
    return null;
  }

  console.log('Extension path verified, loading...');

  try {
    const extension = await session.defaultSession.loadExtension(extensionPath, {
      allowFileAccess: true
    });
    console.log('Loaded Yomitan extension:', extension.name, 'ID:', extension.id);
    yomitanExtension = extension;

    // Create hidden backend window to run the full Yomitan backend with ES modules
    await createBackendWindow(extension);

    return extension;
  } catch (err) {
    console.error('Failed to load Yomitan extension:', err);
    return null;
  }
}

async function createBackendWindow(extension: Electron.Extension) {
  backendWindow = new BrowserWindow({
    width: 400,
    height: 300,
    show: false, // Hidden window
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // No preload - we want pure extension context
    }
  });

  // Load the backend HTML page from the extension
  const backendUrl = `chrome-extension://${extension.id}/background.html`;
  console.log('Loading Yomitan backend from:', backendUrl);

  // Only log backend errors
  backendWindow.webContents.on('console-message', (_event, level, message) => {
    if (level >= 3) { // errors only
      console.log(`[Backend Error] ${message}`);
    }
  });

  try {
    await backendWindow.loadURL(backendUrl);
    console.log('Yomitan backend page loaded');
  } catch (err) {
    console.error('Failed to load Yomitan backend page:', err);
  }
}

function openYomitanSettings() {
  if (!yomitanExtension) {
    console.error('Yomitan extension not loaded');
    return;
  }

  if (!backendWindow || backendWindow.isDestroyed()) {
    console.error('Backend window not available');
    return;
  }

  const settingsUrl = `chrome-extension://${yomitanExtension.id}/settings.html`;
  // Open settings from the backend's extension context - this properly sets up chrome APIs
  backendWindow.webContents.executeJavaScript(`
    (function() {
      const win = window.open('${settingsUrl}', 'yomitan-settings', 'width=1000,height=700');
      return win ? 'Window opened' : 'Window blocked';
    })();
  `).catch((err) => {
    console.error('Failed to open settings:', err);
  });
}

async function init() {
  ocrBridge = new OCRBridge();
  windowManager = new WindowManager();

  // Load Yomitan extension before creating windows
  await loadYomitanExtension();

  try {
    console.log('Starting OCR CLI...');
    await ocrBridge.start();
    console.log('OCR CLI ready');
  } catch (err) {
    console.error('Failed to start OCR CLI:', err);
    dialog.showErrorBox(
      'OCR CLI Error',
      'Failed to start the OCR command line tool. Make sure the CLI is built:\n\n' +
      'cd swift && swift build -c release\n' +
      'cp .build/release/OCRCli ../build/ocrcli'
    );
    app.quit();
    return;
  }

  // Handle OCR CLI crashes
  ocrBridge.on('close', (code: number) => {
    if (code !== 0) {
      console.error('OCR CLI crashed with code:', code);
      windowManager.showError('OCR engine crashed. Restart the app.');
    }
  });

  ocrBridge.on('error', (err: Error) => {
    console.error('OCR CLI error:', err);
    windowManager.showError('OCR engine error: ' + err.message);
  });

  // Create the overlay window
  windowManager.createOverlay();

  // Register global shortcuts
  registerShortcuts();

  console.log('Ready! Shortcuts:');
  console.log('  Option+A: Scan window');
  console.log('  Cmd+Shift+P: Pick window');
  console.log('  Cmd+Shift+H: Toggle overlay');
  console.log('  Cmd+Shift+Y: Yomitan settings');
  console.log('  Escape: Hide overlay');
}

function registerShortcuts() {
  // Option+A: Trigger OCR scan
  globalShortcut.register('Option+A', async () => {
    console.log('Scanning...');
    try {
      const result = await ocrBridge.scan();
      console.log(`Found ${result.observations.length} text regions`);
      console.log('Scan result bounds:', result.bounds);

      // Position overlay to match current target window position
      if (result.bounds) {
        windowManager.positionOverlay(result.bounds);
      } else {
        console.log('No bounds in scan result!');
      }

      windowManager.updateOCRResults(result);
      windowManager.showOverlay();
    } catch (err) {
      console.error('Scan failed:', err);
      const errorMsg = err instanceof Error ? err.message : 'Scan failed';
      // Only show error if it's not a user cancellation
      if (!errorMsg.includes('cancelled')) {
        windowManager.showOverlay();
        windowManager.showError(errorMsg);
      }
    }
  });

  // Cmd+Shift+P: Open window picker
  globalShortcut.register('CommandOrControl+Shift+P', async () => {
    console.log('Opening window picker...');
    try {
      const windowInfo = await ocrBridge.pick();
      console.log('Selected window:', windowInfo.windowTitle || windowInfo.appName);

      if (windowInfo.bounds) {
        windowManager.positionOverlay(windowInfo.bounds);
        windowManager.showOverlay();
      }
    } catch (err) {
      console.error('Window picker failed:', err);
      const errorMsg = err instanceof Error ? err.message : 'Failed to select window';
      // Don't show error for user-cancelled selection
      if (!errorMsg.includes('cancelled')) {
        windowManager.showError(errorMsg);
      }
    }
  });

  // Cmd+Shift+H: Toggle overlay visibility
  globalShortcut.register('CommandOrControl+Shift+H', () => {
    windowManager.toggleOverlay();
  });

  // Escape: Hide overlay
  globalShortcut.register('Escape', () => {
    windowManager.hideOverlay();
  });

  // Cmd+Shift+Y: Open Yomitan settings
  globalShortcut.register('CommandOrControl+Shift+Y', () => {
    openYomitanSettings();
  });
}

// Handle IPC from renderer
ipcMain.handle('get-ocr-results', () => {
  // Return cached results if needed
  return null;
});

app.whenReady().then(init);

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  ocrBridge?.stop();
  windowManager?.destroy();
});

app.on('window-all-closed', () => {
  // Keep app running even when overlay is hidden
});
