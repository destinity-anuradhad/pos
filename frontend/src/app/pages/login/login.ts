import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService, StaffInfo } from '../../services/auth';
import { InactivityService } from '../../services/inactivity';

type Phase = 'staff' | 'pin' | 'loading';

@Component({
  selector: 'app-login',
  standalone: false,
  templateUrl: './login.html',
  styleUrls: ['./login.scss']
})
export class Login implements OnInit {
  phase: Phase = 'staff';
  staffList: StaffInfo[] = [];
  selectedStaff: StaffInfo | null = null;
  pin = '';
  error = '';
  loadingStaff = true;

  constructor(
    private auth: AuthService,
    private inactivity: InactivityService,
    private router: Router,
    private cdr: ChangeDetectorRef,
  ) {
    if (this.auth.isLoggedIn()) this.auth.redirectAfterLogin();
  }

  async ngOnInit(): Promise<void> {
    this.staffList = await this.auth.getStaffList();
    this.loadingStaff = false;
    this.cdr.detectChanges();
  }

  selectStaff(s: StaffInfo): void {
    this.selectedStaff = s;
    this.pin = '';
    this.error = '';
    this.phase = 'pin';
  }

  back(): void {
    this.phase = 'staff';
    this.selectedStaff = null;
    this.pin = '';
    this.error = '';
  }

  pressDigit(d: string): void {
    if (this.pin.length < 6) this.pin += d;
    if (this.pin.length >= 4) this.error = '';
  }

  pressBack(): void {
    this.pin = this.pin.slice(0, -1);
  }

  async submit(): Promise<void> {
    if (!this.selectedStaff || this.pin.length < 4) return;
    this.phase = 'loading';
    this.error = '';
    const result = await this.auth.login(this.selectedStaff.id, this.pin);
    if (result.success) {
      this.inactivity.start();
      this.auth.redirectAfterLogin();
    } else {
      this.error = result.error || 'Incorrect PIN';
      this.pin = '';
      this.phase = 'pin';
      this.cdr.detectChanges();
    }
  }

  getRoleLabel(role: string): string {
    const map: Record<string, string> = { admin: 'Admin', manager: 'Manager', cashier: 'Cashier' };
    return map[role] || role;
  }

  getRoleColor(role: string): string {
    const map: Record<string, string> = { admin: '#ef4444', manager: '#f59e0b', cashier: '#22c55e' };
    return map[role] || '#6b7280';
  }

  get pinDots(): boolean[] {
    return Array.from({ length: 4 }, (_, i) => i < this.pin.length);
  }
}
