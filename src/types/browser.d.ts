/**
 * browser.d.ts
 * Controle de Validades | Skalee
 * Declarações de tipos para APIs do navegador, PWA e Web APIs específicas.
 */

interface Navigator {
  standalone?: boolean;
}

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt(): Promise<void>;
}

interface WindowEventMap {
  beforeinstallprompt: BeforeInstallPromptEvent;
  appinstalled: Event;
  "skalee:sync-status-changed": CustomEvent<{ pending: number }>;
  "skalee:sync-queue-updated": CustomEvent<void>;
}

interface BarcodeDetectorOptions {
  formats?: string[];
}

interface DetectedBarcode {
  boundingBox: DOMRectReadOnly;
  cornerPoints: Array<{ x: number; y: number }>;
  format: string;
  rawValue: string;
}

declare class BarcodeDetector {
  constructor(options?: BarcodeDetectorOptions);
  static getSupportedFormats(): Promise<string[]>;
  detect(image: ImageBitmapSource): Promise<DetectedBarcode[]>;
}

interface PhotoCapabilities {
  redEyeReduction: "never" | "always" | "controllable";
  imageHeight: { max: number; min: number; step: number };
  imageWidth: { max: number; min: number; step: number };
  fillLightMode: Array<"auto" | "off" | "flash">;
}

interface PhotoSettings {
  fillLightMode?: "auto" | "off" | "flash";
  imageHeight?: number;
  imageWidth?: number;
  redEyeReduction?: boolean;
}

declare class ImageCapture {
  constructor(track: MediaStreamTrack);
  readonly track: MediaStreamTrack;
  takePhoto(photoSettings?: PhotoSettings): Promise<Blob>;
  getPhotoCapabilities(): Promise<PhotoCapabilities>;
  getPhotoSettings(): Promise<PhotoSettings>;
  grabFrame(): Promise<ImageBitmap>;
}

