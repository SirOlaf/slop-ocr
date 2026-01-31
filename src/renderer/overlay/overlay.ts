interface TextObservation {
  text: string;
  confidence: number;
  boundingBox: { x: number; y: number; width: number; height: number };
  topLeft: { x: number; y: number };
  topRight: { x: number; y: number };
  bottomRight: { x: number; y: number };
  bottomLeft: { x: number; y: number };
}

interface OCRData {
  imageWidth: number;
  imageHeight: number;
  observations: TextObservation[];
}

interface OcrOverlayAPI {
  onOCRResults: (callback: (data: OCRData) => void) => void;
  onLoadingState: (callback: (isLoading: boolean) => void) => void;
  onError: (callback: (message: string) => void) => void;
}

declare const ocrOverlay: OcrOverlayAPI;

console.log('Overlay script starting...');
console.log('window.ocrOverlay:', ocrOverlay);

const container = document.getElementById('ocr-container')!;
const loadingIndicator = document.getElementById('loading-indicator')!;
const errorMessage = document.getElementById('error-message')!;

if (!ocrOverlay) {
  console.error('ERROR: ocrOverlay API not available! Preload script may not have loaded.');
}
if (!container) {
  console.error('ERROR: ocr-container element not found!');
}

function showLoading(show: boolean): void {
  if (show) {
    loadingIndicator.classList.remove('hidden');
    errorMessage.classList.add('hidden');
  } else {
    loadingIndicator.classList.add('hidden');
  }
}

function showError(message: string): void {
  errorMessage.textContent = message;
  errorMessage.classList.remove('hidden');
  loadingIndicator.classList.add('hidden');
  // Auto-hide error after 5 seconds
  setTimeout(() => {
    errorMessage.classList.add('hidden');
  }, 5000);
}

function clearOverlay(): void {
  container.innerHTML = '';
}

function calculateRotation(obs: TextObservation): number {
  // Calculate rotation angle from the quadrilateral
  const dx = obs.topRight.x - obs.topLeft.x;
  const dy = obs.topRight.y - obs.topLeft.y;
  return Math.atan2(-dy, dx) * (180 / Math.PI);
}

function fitTextToWidth(span: HTMLSpanElement, targetWidth: number, maxFontSize: number): void {
  const MIN_FONT_SIZE = 8;

  // Start with max font size (box height)
  span.style.fontSize = `${maxFontSize}px`;

  const measuredWidth = span.scrollWidth;

  if (measuredWidth <= targetWidth) {
    // Text fits at max size, use it
    return;
  }

  // Scale font size proportionally to fit width
  const scaledSize = maxFontSize * (targetWidth / measuredWidth);
  const finalSize = Math.max(scaledSize, MIN_FONT_SIZE);
  span.style.fontSize = `${finalSize}px`;
}

function renderOCRResults(data: OCRData): void {
  clearOverlay();

  const overlayWidth = container.clientWidth;
  const overlayHeight = container.clientHeight;

  for (const obs of data.observations) {
    // Vision framework uses bottom-left origin, so we need to flip Y
    // boundingBox.y is the bottom of the text in Vision coordinates
    const baseX = obs.boundingBox.x * overlayWidth;
    const baseY = (1 - obs.boundingBox.y - obs.boundingBox.height) * overlayHeight;
    const baseWidth = obs.boundingBox.width * overlayWidth;
    const baseHeight = obs.boundingBox.height * overlayHeight;

    // Skip very small boxes that are likely noise
    if (baseWidth < 10 || baseHeight < 8) {
      continue;
    }

    // Expand box by 1px in each direction for better coverage
    const x = baseX - 1;
    const y = baseY - 1;
    const width = baseWidth + 2;
    const height = baseHeight + 2;

    const span = document.createElement('span');
    span.className = 'ocr-text';
    span.textContent = obs.text;

    // Calculate rotation from quadrilateral points
    const rotation = calculateRotation(obs);

    span.style.left = `${x}px`;
    span.style.top = `${y}px`;
    span.style.width = `${width}px`;
    span.style.height = `${height}px`;

    // Apply rotation if text is tilted
    if (Math.abs(rotation) > 0.5) {
      span.style.transformOrigin = 'left top';
      span.style.transform = `rotate(${rotation}deg)`;
    }

    // Add to DOM first so we can measure
    container.appendChild(span);

    // Fit text to bounding box width, with max size based on height
    fitTextToWidth(span, width, height);
  }

  console.log(`Rendered ${data.observations.length} text regions`);
}

// Listen for OCR results from main process
ocrOverlay.onOCRResults((data: OCRData) => {
  console.log('Received OCR results:', data.observations.length, 'observations');
  showLoading(false);
  renderOCRResults(data);
});

// Listen for loading state changes
ocrOverlay.onLoadingState((isLoading: boolean) => {
  console.log('Loading state:', isLoading);
  showLoading(isLoading);
});

// Listen for error messages
ocrOverlay.onError((message: string) => {
  console.log('Error:', message);
  showError(message);
});

console.log('Overlay ready');
