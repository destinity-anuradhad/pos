import { Injectable } from '@angular/core';
import { ApiService, ApiTerminal, resolveCloudBase } from './api';

const TERMINAL_UUID_KEY      = 'terminal_uuid';
const TERMINAL_ID_KEY        = 'terminal_id';
const TERMINAL_CODE_KEY      = 'terminal_code';
const TERMINAL_NAME_KEY      = 'terminal_name';
const TERMINAL_CLOUD_ID_KEY  = 'terminal_cloud_id';

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

  getCloudTerminalId(): number | null {
    const id = localStorage.getItem(TERMINAL_CLOUD_ID_KEY);
    return id ? parseInt(id) : null;
  }

  /** Register this terminal with the local backend, then also with the cloud. */
  async register(terminalCode: string, terminalName: string, registeredBy?: string): Promise<ApiTerminal> {
    const uuid     = this.getUUID();
    const platform = detectPlatform();
    const code     = terminalCode.trim().toUpperCase();
    const name     = terminalName.trim();

    // 1. Register with local backend
    const terminal = await this.api.registerTerminal({
      uuid,
      terminal_code: code,
      terminal_name: name,
      platform,
      registered_by: registeredBy || null,
    });

    localStorage.setItem(TERMINAL_ID_KEY,   terminal.id.toString());
    localStorage.setItem(TERMINAL_CODE_KEY, terminal.terminal_code);
    localStorage.setItem(TERMINAL_NAME_KEY, terminal.terminal_name);

    // 2. Register with cloud HQ (fire and forget — offline is OK)
    this.registerWithCloud(code, name, uuid).catch(() => {});

    return terminal;
  }

  /** Register terminal in the cloud HQ database. */
  private async registerWithCloud(code: string, name: string, uuid: string): Promise<void> {
    const cloudBase = resolveCloudBase();
    const res = await fetch(`${cloudBase}/terminals/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        terminal_code: code,
        terminal_name: name,
        uuid,
        outlet_code: 'MAIN-01',
      }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.id) {
        localStorage.setItem(TERMINAL_CLOUD_ID_KEY, data.id.toString());
      }
    }
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
