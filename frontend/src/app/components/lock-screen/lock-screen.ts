import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { Subscription } from 'rxjs';
import { AuthService, StaffInfo } from '../../services/auth';
import { InactivityService } from '../../services/inactivity';

type LockPhase = 'locked' | 'staff' | 'pin';

@Component({
  selector: 'app-lock-screen',
  standalone: false,
  templateUrl: './lock-screen.html',
  styleUrls: ['./lock-screen.scss']
})
export class LockScreenComponent implements OnInit, OnDestroy {
  visible = false;
  phase: LockPhase = 'locked';
  staffList: StaffInfo[] = [];
  selectedStaff: StaffInfo | null = null;
  pin = '';
  password = '';
  error = '';
  attempts = 0;
  shaking = false;
  currentTime = '';

  private _sub?: Subscription;
  private _clockTimer?: ReturnType<typeof setInterval>;

  constructor(
    private auth: AuthService,
    private inactivity: InactivityService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this._sub = this.inactivity.locked$.subscribe(async locked => {
      this.visible = locked;
      if (locked) {
        this.phase = 'locked';
        this.pin = '';
        this.error = '';
        this.attempts = 0;
        this.selectedStaff = null;
        this._startClock();
        this.staffList = await this.auth.getStaffList();
      } else {
        this._stopClock();
      }
      this.cdr.detectChanges();
    });
  }

  ngOnDestroy(): void {
    this._sub?.unsubscribe();
    this._stopClock();
  }

  tapLock(): void {
    this.phase = 'staff';
    this.cdr.detectChanges();
  }

  get isCashier(): boolean { return this.selectedStaff?.role === 'cashier'; }

  selectStaff(s: StaffInfo): void {
    this.selectedStaff = s;
    this.pin = '';
    this.password = '';
    this.error = '';
    this.phase = 'pin';
  }

  backToStaff(): void {
    this.phase = 'staff';
    this.selectedStaff = null;
    this.pin = '';
    this.password = '';
    this.error = '';
  }

  pressDigit(d: string): void {
    if (this.pin.length < 6) {
      this.pin += d;
      if (this.pin.length >= 4) this.error = '';
      if (this.pin.length === 4) this._tryUnlock();
    }
  }

  pressBack(): void {
    this.pin = this.pin.slice(0, -1);
  }

  async submitPassword(): Promise<void> {
    if (!this.password) return;
    await this._tryUnlock();
  }

  private async _tryUnlock(): Promise<void> {
    if (!this.selectedStaff) return;
    const credential = this.isCashier ? this.pin : this.password;
    const ok = await this.auth.verifyPin(this.selectedStaff.username, credential);
    if (ok) {
      this.inactivity.unlock();
    } else {
      this.attempts++;
      this.pin = '';
      this.password = '';
      const label = this.isCashier ? 'PIN' : 'Password';
      this.error = this.attempts >= 3
        ? `Incorrect ${label} (${this.attempts} attempts)`
        : `Incorrect ${label}`;
      this._shake();
    }
    this.cdr.detectChanges();
  }

  private _shake(): void {
    this.shaking = true;
    setTimeout(() => { this.shaking = false; this.cdr.detectChanges(); }, 500);
  }

  private _startClock(): void {
    this._updateClock();
    this._clockTimer = setInterval(() => { this._updateClock(); this.cdr.detectChanges(); }, 1000);
  }

  private _stopClock(): void {
    if (this._clockTimer) clearInterval(this._clockTimer);
  }

  private _updateClock(): void {
    this.currentTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  getRoleColor(role: string): string {
    const map: Record<string, string> = { admin: '#ef4444', manager: '#f59e0b', cashier: '#22c55e' };
    return map[role] || '#6b7280';
  }

  getRoleLabel(role: string): string {
    const map: Record<string, string> = { admin: 'Admin', manager: 'Manager', cashier: 'Cashier' };
    return map[role] || role;
  }

  get pinDots(): boolean[] {
    return Array.from({ length: 4 }, (_, i) => i < this.pin.length);
  }
}
