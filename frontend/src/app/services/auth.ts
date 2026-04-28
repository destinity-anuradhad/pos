import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';

export interface StaffSession {
  staffId: number;
  name: string;
  role: 'cashier' | 'manager' | 'admin';
  exp: number;
  token: string;
}

// Staff info for the login screen (no sensitive data)
export interface StaffInfo {
  id: number;
  name: string;
  role: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  // Token stored ONLY in memory — never written to localStorage
  private _session: StaffSession | null = null;
  private _session$ = new BehaviorSubject<StaffSession | null>(null);

  session$ = this._session$.asObservable();

  constructor(private router: Router) {}

  get session(): StaffSession | null { return this._session; }

  isLoggedIn(): boolean {
    if (!this._session) return false;
    // Check token not expired
    return Date.now() / 1000 < this._session.exp;
  }

  hasRole(...roles: string[]): boolean {
    return !!this._session && roles.includes(this._session.role);
  }

  canAccess(feature: 'products' | 'tables' | 'sync' | 'reports' | 'staff' | 'settings'): boolean {
    const role = this._session?.role;
    if (!role) return false;
    if (role === 'admin')   return true;
    if (role === 'manager') return feature !== 'staff';
    // cashier: only pos/orders/dashboard
    return false;
  }

  /** Fetch list of active staff for login screen */
  async getStaffList(): Promise<StaffInfo[]> {
    try {
      const apiUrl = this._getApiUrl();
      const res = await fetch(`${apiUrl}/auth/staff`);
      if (!res.ok) return [];
      return await res.json();
    } catch {
      return [];
    }
  }

  /** Login with staff_id + PIN. Returns true on success. */
  async login(staffId: number, pin: string): Promise<{ success: boolean; error?: string }> {
    try {
      const apiUrl = this._getApiUrl();
      const res = await fetch(`${apiUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staff_id: staffId, pin }),
      });
      const data = await res.json();
      if (!res.ok) return { success: false, error: data.error || 'Login failed' };
      this._setSession(data.token, data.name, data.role);
      return { success: true };
    } catch {
      return { success: false, error: 'Cannot reach server. Make sure the backend is running.' };
    }
  }

  /** Re-verify PIN (used by lock screen to unlock) */
  async verifyPin(staffId: number, pin: string): Promise<boolean> {
    const result = await this.login(staffId, pin);
    return result.success;
  }

  logout(): void {
    this._session = null;
    this._session$.next(null);
    this.router.navigate(['/login']);
  }

  redirectAfterLogin(): void {
    this.router.navigate(['/dashboard']);
  }

  getToken(): string | null {
    return this._session?.token ?? null;
  }

  private _setSession(token: string, name: string, role: string): void {
    try {
      const [, payload] = token.split('.');
      const decoded = JSON.parse(atob(payload));
      this._session = {
        staffId: decoded.sub,
        name: decoded.name || name,
        role: (decoded.role || role) as StaffSession['role'],
        exp: decoded.exp,
        token,
      };
      this._session$.next(this._session);
    } catch {
      this._session = null;
      this._session$.next(null);
    }
  }

  private _getApiUrl(): string {
    const stored = localStorage.getItem('api_url');
    if (stored) return stored;
    const isElectron = !!(window as any).electronAPI?.isElectron;
    const isCapacitor = !!(window as any).Capacitor?.isNativePlatform?.();
    if (isElectron) return 'http://localhost:8000/api';
    if (isCapacitor) return 'http://192.168.137.1:8000/api';
    return 'http://localhost:8000/api';
  }
}
