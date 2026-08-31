import { AppConfig, GlobalSettings, Target } from '../types';

const STORAGE_KEY = 'screen_detector_config_v1';

export const DEFAULT_SETTINGS: GlobalSettings = {
  scanFps: 30,
  matchAlgorithm: 'ncc',
  enableAudio: true,
  masterVolume: 0.8,
  speechVolume: 1.0,
  flashScreenOnHit: true,
  showBoundingBoxesOnStream: true,
  showRoiOnStream: true,
  confettiOnHit: true,
  autoScrollLogs: true,
};

export const COLOR_PALETTE = [
  '#10B981', // Emerald
  '#3B82F6', // Blue
  '#F59E0B', // Amber
  '#EF4444', // Red
  '#8B5CF6', // Purple
  '#EC4899', // Pink
  '#06B6D4', // Cyan
  '#14B8A6', // Teal
  '#F97316', // Orange
  '#6366F1', // Indigo
];

export function getNextColor(existingTargets: Target[]): string {
  const usedColors = new Set(existingTargets.map((t) => t.color));
  const available = COLOR_PALETTE.find((c) => !usedColors.has(c));
  return available || COLOR_PALETTE[existingTargets.length % COLOR_PALETTE.length];
}

export function loadConfigFromStorage(): AppConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AppConfig;
      if (parsed && Array.isArray(parsed.targets)) {
        return {
          version: parsed.version || '1.0',
          targets: parsed.targets,
          groups: Array.isArray(parsed.groups) ? parsed.groups : [],
          settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
        };
      }
    }
  } catch (err) {
    console.warn('Failed to load saved config from localStorage:', err);
  }

  return {
    version: '1.0',
    targets: [],
    groups: [],
    settings: DEFAULT_SETTINGS,
  };
}

export function saveConfigToStorage(config: AppConfig): void {
  try {
    // Strip runtime properties like currentSimilarity
    const cleanTargets = config.targets.map((t) => ({
      id: t.id,
      name: t.name,
      enabled: t.enabled,
      color: t.color,
      imageDataUrl: t.imageDataUrl,
      imageWidth: t.imageWidth,
      imageHeight: t.imageHeight,
      groupId: t.groupId ?? null,
      threshold: t.threshold,
      cooldownSeconds: t.cooldownSeconds,
      normalizedRoi: t.normalizedRoi || null,
      soundType: t.soundType,
      // Per-target volumes were previously dropped here, so they reset on every reload.
      volume: t.volume,
      speechVolume: t.speechVolume,
      customSoundDataUrl: t.customSoundDataUrl,
      speakName: t.speakName,
      browserNotification: t.browserNotification,
    }));

    const cleanConfig: AppConfig = {
      version: '1.0',
      targets: cleanTargets as Target[],
      groups: (config.groups || []).map((g) => ({
        id: g.id,
        name: g.name,
        color: g.color,
        collapsed: g.collapsed,
      })),
      settings: config.settings,
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(cleanConfig));
  } catch (err) {
    console.warn('Failed to save config to localStorage:', err);
  }
}

export function exportConfigAsJson(config: AppConfig, filename = 'screen-detector-settings.json'): void {
  const jsonStr = JSON.stringify(config, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function importConfigFromJson(file: File): Promise<AppConfig> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const parsed = JSON.parse(text) as AppConfig;
        if (!parsed || !Array.isArray(parsed.targets)) {
          throw new Error('Invalid JSON format: missing targets array');
        }
        resolve({
          version: parsed.version || '1.0',
          targets: parsed.targets,
          groups: Array.isArray(parsed.groups) ? parsed.groups : [],
          settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
        });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = (e) => reject(e);
    reader.readAsText(file);
  });
}
