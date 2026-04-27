import { Injectable } from '@angular/core';

export type AppMode = 'restaurant' | 'retail';
const MODE_KEY = 'pos_mode';

@Injectable({ providedIn: 'root' })
export class AppModeService {
  getMode(): AppMode | null {
    return localStorage.getItem(MODE_KEY) as AppMode | null;
  }

  setMode(mode: AppMode): void {
    localStorage.setItem(MODE_KEY, mode);
  }

  clearMode(): void {
    localStorage.removeItem(MODE_KEY);
  }

  isRestaurant(): boolean { return this.getMode() === 'restaurant'; }
  isRetail(): boolean     { return this.getMode() === 'retail'; }
}
