import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private key = 'pos_theme';

  init(): void {
    if (this.isDark()) document.body.classList.add('dark');
  }

  isDark(): boolean {
    return localStorage.getItem(this.key) === 'dark';
  }

  toggle(): void {
    if (this.isDark()) {
      localStorage.setItem(this.key, 'light');
      document.body.classList.remove('dark');
    } else {
      localStorage.setItem(this.key, 'dark');
      document.body.classList.add('dark');
    }
  }
}
