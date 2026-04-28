import { Injectable } from '@angular/core';
import { ApiService, ApiTerminal } from './api';

const TERMINAL_UUID_KEY = 'terminal_uuid';
const TERMINAL_ID_KEY   = 'terminal_id';
const TERMINAL_CODE_KEY = 'terminal_code';
const TERMINAL_NAME_KEY = 'terminal_name';

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
    return !!localStorage.getItem(TERMINAL_UUID_KEY) && !!localStorage.getItem(TERMINAL_ID_KEY);
  }

  getUUID(): string {
    let uuid = localStorage.getItem(TERMINAL_UUID_KEY);
    if (!uuid) {
      uuid = generateUUID();
      localStorage.setItem(TERMINAL_UUID_KEY, uuid);
    }
    return uuid;
  }

  getTerminalId(): number | null {
    const id = localStorage.getItem(TERMINAL_ID_KEY);
    return id ? parseInt(id) : null;
  }

  getTerminalCode(): string {
    return localStorage.getItem(TERMINAL_CODE_KEY) || '';
  }

  getTerminalName(): string {
    return localStorage.getItem(TERMINAL_NAME_KEY) || '';
  }

  getPlatform(): string {
    return detectPlatform();
  }

  /** Register this terminal with the backend. Called from terminal-setup page. */
  async register(terminalCode: string, terminalName: string, registeredBy?: string): Promise<ApiTerminal> {
    const uuid     = this.getUUID();
    const platform = detectPlatform();

    const terminal = await this.api.registerTerminal({
      uuid,
      terminal_code: terminalCode.trim().toUpperCase(),
      terminal_name: terminalName.trim(),
      platform,
      registered_by: registeredBy || null,
    });

    localStorage.setItem(TERMINAL_ID_KEY,   terminal.id.toString());
    localStorage.setItem(TERMINAL_CODE_KEY, terminal.terminal_code);
    localStorage.setItem(TERMINAL_NAME_KEY, terminal.terminal_name);
    return terminal;
  }

  /** Re-verify registration with cloud (on each startup when online). */
  async verifyWithCloud(): Promise<void> {
    const uuid = localStorage.getItem(TERMINAL_UUID_KEY);
    if (!uuid) return;
    try {
      const terminal = await this.api.getTerminalByUuid(uuid);
      localStorage.setItem(TERMINAL_ID_KEY,   terminal.id.toString());
      localStorage.setItem(TERMINAL_CODE_KEY, terminal.terminal_code);
      localStorage.setItem(TERMINAL_NAME_KEY, terminal.terminal_name);
    } catch {
      // offline — continue with cached values
    }
  }

  /** Send heartbeat to update last_seen_at. */
  async heartbeat(): Promise<void> {
    const id = this.getTerminalId();
    if (id) {
      try { await this.api.terminalHeartbeat(id); } catch { /* offline */ }
    }
  }
}
