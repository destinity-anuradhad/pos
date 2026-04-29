import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { LocalDbService } from './local-db.service';
import { NativeDbService } from './native-db.service';

export interface StaffSession {
  staffId: number;
  name: string;
  role: 'cashier' | 'manager' | 'admin';
  exp: number;
  token: string;
}

export interface StaffInfo {
  id: number;
  uuid: string;
  username: string;
  display_name: string;
  role: string;
}

export function isWebPlatform(): boolean {
  const ua = navigator.userAgent.toLowerCase();
  const hasElectron  = typeof (window as any).electronAPI !== 'undefined' || ua.includes('electron');
  const hasCapacitor = typeof (window as any).Capacitor !== 'undefined' && !!(window as any).Capacitor?.isNativePlatform?.();
  return !hasElectron && !hasCapacitor;
}

/** True on Android/iOS Capacitor native (NOT Electron, NOT plain browser) */
export function isCapacitorNative(): boolean {
  return typeof (window as any).Capacitor !== 'undefined' &&
    !!(window as any).Capacitor?.isNativePlatform?.();
}

/** True whenever local offline storage should be used (web browser OR Capacitor native). */
export function useLocalDb(): boolean {
  const ua = navigator.userAgent.toLowerCase();
  const hasElectron = typeof (window as any).electronAPI !== 'undefined' || ua.includes('electron');
  return !hasElectron; // web OR mobile — anything that's not Electron uses local DB
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private _session: StaffSession | null = null;
  private _session$ = new BehaviorSubject<StaffSession | null>(null);

  session$ = this._session$.asObservable();

  constructor(private router: Router, private localDb: LocalDbService, private nativeDb: NativeDbService) {}

  private get _localDb(): LocalDbService | NativeDbService {
    return isCapacitorNative() ? this.nativeDb : this.localDb;
  }

  get session(): StaffSession | null { return this._session; }

  isLoggedIn(): boolean {
    if (!this._session) return false;
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
    return false;
  }

  /** Fetch list of active staff for the login screen */
  async getStaffList(): Promise<StaffInfo[]> {
    if (useLocalDb()) {
      return this._localDb.getStaffList();
    }
    try {
      const apiUrl = this._getApiUrl();
      const res = await fetch(`${apiUrl}/auth/staff`);
      if (!res.ok) return [];
      return await res.json();
    } catch {
      return [];
    }
  }

  /** Login with username + PIN (cashier) or username + password (manager/admin) */
  async login(username: string, credential: string, isPassword = false): Promise<{ success: boolean; error?: string }> {
    if (useLocalDb()) {
      return this._localLogin(username, credential);
    }
    try {
      const apiUrl = this._getApiUrl();
      const body: any = { username };
      if (isPassword) body.password = credential; else body.pin = credential;
      const res = await fetch(`${apiUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) return { success: false, error: data.error || 'Login failed' };
      this._setSession(data.token, data.staff?.display_name ?? '', data.staff?.role ?? '');
      return { success: true };
    } catch {
      return { success: false, error: 'Cannot reach server. Make sure the backend is running.' };
    }
  }

  async verifyPin(username: string, pin: string): Promise<boolean> {
    const result = await this.login(username, pin, false);
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

  // ── Web (local IndexedDB) auth ─────────────────────────────────────────────

  private async _localLogin(username: string, pin: string): Promise<{ success: boolean; error?: string }> {
    const result = await this._localDb.login(username, pin);
    if (!result.success || !result.staff) return { success: false, error: result.error || 'Login failed' };
    const s = result.staff;
    // Create a web-local "token": header.payload.sig  (payload is base64 JSON)
    const payload = btoa(JSON.stringify({ sub: s.id, name: s.display_name, role: s.role, exp: Math.floor(Date.now() / 1000) + 8 * 3600 }));
    const token = `web.${payload}.local`;
    this._setSession(token, s.display_name, s.role);
    return { success: true };
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
    const isElectron  = !!(window as any).electronAPI?.isElectron;
    const isCapacitor = !!(window as any).Capacitor?.isNativePlatform?.();
    if (isElectron)  return 'http://localhost:8000/api';
    if (isCapacitor) return 'http://192.168.137.1:8000/api';
    return 'http://localhost:8000/api';
  }
}
