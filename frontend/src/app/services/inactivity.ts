import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

const TIMEOUT_KEY = 'inactivity_timeout_minutes';
const DEFAULT_TIMEOUT_MIN = 5;

@Injectable({ providedIn: 'root' })
export class InactivityService {
  private _locked$ = new BehaviorSubject<boolean>(false);
  locked$ = this._locked$.asObservable();

  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _started = false;

  constructor(private zone: NgZone) {}

  get isLocked(): boolean { return this._locked$.value; }

  /** Call once after login. Sets up event listeners and starts the timer. */
  start(): void {
    if (this._started) { this._resetTimer(); return; }
    this._started = true;

    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
    events.forEach(e =>
      document.addEventListener(e, () => this._resetTimer(), { passive: true })
    );
    this._resetTimer();
  }

  stop(): void {
    if (this._timer) clearTimeout(this._timer);
    this._started = false;
    this._locked$.next(false);
  }

  unlock(): void {
    this._locked$.next(false);
    this._resetTimer();
  }

  lockNow(): void {
    if (this._timer) clearTimeout(this._timer);
    this.zone.run(() => this._locked$.next(true));
  }

  getTimeoutMinutes(): number {
    return parseInt(localStorage.getItem(TIMEOUT_KEY) || String(DEFAULT_TIMEOUT_MIN), 10);
  }

  setTimeoutMinutes(minutes: number): void {
    localStorage.setItem(TIMEOUT_KEY, String(minutes));
    this._resetTimer();
  }

  private _resetTimer(): void {
    if (this._locked$.value) return;
    if (this._timer) clearTimeout(this._timer);
    const ms = this.getTimeoutMinutes() * 60 * 1000;
    this._timer = setTimeout(() => {
      this.zone.run(() => this._locked$.next(true));
    }, ms);
  }
}
