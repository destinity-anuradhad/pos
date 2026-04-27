import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

export type ShortcutAction = 'search' | 'checkout' | 'newOrder' | 'toggleDark' | 'goPos' | 'goDashboard' | 'goProducts' | 'goOrders' | 'help';

@Injectable({ providedIn: 'root' })
export class KeyboardShortcutsService {
  private action$ = new Subject<ShortcutAction>();
  action = this.action$.asObservable();

  private active = false;

  enable(): void {
    if (this.active) return;
    this.active = true;
    document.addEventListener('keydown', this.handleGlobal.bind(this));
  }

  private handleGlobal(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement).tagName;
    const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

    if (e.altKey) {
      switch (e.key) {
        case '1': e.preventDefault(); this.action$.next('goDashboard'); break;
        case '2': e.preventDefault(); this.action$.next('goPos'); break;
        case '3': e.preventDefault(); this.action$.next('goProducts'); break;
        case '4': e.preventDefault(); this.action$.next('goOrders'); break;
        case 'd': e.preventDefault(); this.action$.next('toggleDark'); break;
      }
    }

    if (inInput) return;

    if (e.key === '/') { e.preventDefault(); this.action$.next('search'); }
    if (e.key === 'F2') { e.preventDefault(); this.action$.next('checkout'); }
    if (e.key === 'F3') { e.preventDefault(); this.action$.next('newOrder'); }
    if (!inInput && e.key === '?') { e.preventDefault(); this.action$.next('help'); }
  }
}
