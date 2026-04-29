import { Injectable } from '@angular/core';
import { ApiService, ApiTerminal, resolveCloudBase } from './api';

const TERMINAL_UUID_KEY   = 'terminal_uuid';
const TERMINAL_CODE_KEY   = 'terminal_code';
const TERMINAL_NAME_KEY   = 'terminal_name';
const OUTLET_UUID_KEY     = 'outlet_uuid';
const OUTLET_CODE_KEY     = 'outlet_code';
const OUTLET_NAME_KEY     = 'outlet_name';

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function detectPlatform(): string {
  const ua = navigator.userAgent.toLowerCase();
  if (typeof (window as any).electronAPI !== 'undefined' || ua.includes('electron')) return 'windows';
  if (typeof (window as any).Capacitor !== 'undefined' && (window as any).Capacitor?.isNativePlatform?.()) {
    return /iphone|ipad/.test(ua) ? 'ios' : 'android';
  }
  return 'web';
}

@Injectable({ providedIn: 'root' })
export class TerminalService {
  constructor(private api: ApiService) {}

  isRegistered(): boolean {
    return !!localStorage.getItem(TERMINAL_UUID_KEY) && !!localStorage.getItem(TERMINAL_CODE_KEY);
  }

  getUUID(): string {
    let uuid = localStorage.getItem(TERMINAL_UUID_KEY);
    if (!uuid) {
      uuid = generateUUID();
      localStorage.setItem(TERMINAL_UUID_KEY, uuid);
    }
    return uuid;
  }

  getTerminalCode(): string  { return localStorage.getItem(TERMINAL_CODE_KEY) || ''; }
  getTerminalName(): string  { return localStorage.getItem(TERMINAL_NAME_KEY) || ''; }
  getOutletCode(): string    { return localStorage.getItem(OUTLET_CODE_KEY) || ''; }
  getOutletName(): string    { return localStorage.getItem(OUTLET_NAME_KEY) || ''; }
  getOutletUUID(): string    { return localStorage.getItem(OUTLET_UUID_KEY) || ''; }
  getPlatform(): string      { return detectPlatform(); }

  /** Register this terminal with the local backend. */
  async register(
    terminalCode: string, terminalName: string,
    outletCode: string,   outletName: string,
  ): Promise<ApiTerminal> {
    const terminalUUID = this.getUUID();
    const outletUUID   = localStorage.getItem(OUTLET_UUID_KEY) || generateUUID();

    const terminal = await this.api.registerTerminal({
      terminal_uuid: terminalUUID,
      terminal_code: terminalCode.trim().toUpperCase(),
      terminal_name: terminalName.trim(),
      outlet_uuid:   outletUUID,
      outlet_code:   outletCode.trim().toUpperCase(),
      outlet_name:   outletName.trim(),
    });

    localStorage.setItem(TERMINAL_UUID_KEY, terminal.terminal_uuid);
    localStorage.setItem(TERMINAL_CODE_KEY, terminal.terminal_code);
    localStorage.setItem(TERMINAL_NAME_KEY, terminal.terminal_name);
    localStorage.setItem(OUTLET_UUID_KEY,   terminal.outlet_uuid);
    localStorage.setItem(OUTLET_CODE_KEY,   terminal.outlet_code);
    localStorage.setItem(OUTLET_NAME_KEY,   terminal.outlet_name);

    // Register with cloud HQ (fire and forget — offline is OK)
    this.registerWithCloud(terminal).catch(() => {});

    return terminal;
  }

  private async registerWithCloud(t: ApiTerminal): Promise<void> {
    const cloudBase = resolveCloudBase();
    await fetch(`${cloudBase}/terminals/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        terminal_uuid: t.terminal_uuid,
        terminal_code: t.terminal_code,
        terminal_name: t.terminal_name,
        outlet_uuid:   t.outlet_uuid,
        outlet_code:   t.outlet_code,
        outlet_name:   t.outlet_name,
      }),
    });
  }

  /** Re-verify registration with backend on startup (only if already registered locally). */
  async verifyWithCloud(): Promise<void> {
    if (!this.isRegistered()) return; // fresh install — nothing to verify
    try {
      const t = await this.api.getTerminalInfo();
      localStorage.setItem(TERMINAL_UUID_KEY, t.terminal_uuid);
      localStorage.setItem(TERMINAL_CODE_KEY, t.terminal_code);
      localStorage.setItem(TERMINAL_NAME_KEY, t.terminal_name);
      localStorage.setItem(OUTLET_UUID_KEY,   t.outlet_uuid);
      localStorage.setItem(OUTLET_CODE_KEY,   t.outlet_code);
      localStorage.setItem(OUTLET_NAME_KEY,   t.outlet_name);
    } catch {
      // offline — continue with cached values
    }
  }

  /** Send heartbeat (no-op for now — endpoint removed). */
  async heartbeat(): Promise<void> {}
}
