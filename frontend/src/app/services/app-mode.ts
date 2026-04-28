import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class AppModeService {
  getMode(): string { return 'restaurant'; }
  isRestaurant(): boolean { return true; }
  isRetail(): boolean { return false; }
}
