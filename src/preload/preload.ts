import { contextBridge, ipcRenderer } from 'electron';

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
}

contextBridge.exposeInMainWorld('ocrOverlay', {
  onOCRResults: (callback: (data: OCRData) => void) => {
    ipcRenderer.on('ocr-results', (_event, data: OCRData) => {
      callback(data);
    });
  },
  onLoadingState: (callback: (isLoading: boolean) => void) => {
    ipcRenderer.on('ocr-loading', (_event, isLoading: boolean) => {
      callback(isLoading);
    });
  },
  onError: (callback: (message: string) => void) => {
    ipcRenderer.on('ocr-error', (_event, message: string) => {
      callback(message);
    });
  }
});
