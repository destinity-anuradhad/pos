import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { SyncService, SyncState } from '../../services/sync';
import { ApiService, ApiSyncLog, SyncSettings } from '../../services/api';
import { DatabaseService } from '../../services/database';
import { TerminalService } from '../../services/terminal';
import { useLocalDb } from '../../services/auth';

@Component({
  selector: 'app-sync-page',
  standalone: false,
  templateUrl: './sync-page.html',
  styleUrls: ['./sync-page.scss']
})
export class SyncPage implements OnInit {
  state: SyncState = {
    lastMasterSync: null,
    lastTransactionSync: null,
    pendingOrderCount: 0,
    pendingMasterCount: 0,
    isSyncing: false,
    lastError: null,
  };
  logs: ApiSyncLog[] = [];
  settings: SyncSettings | null = null;

  syncingMaster      = false;
  syncingMasterUp    = false;
  syncingTransaction = false;
  masterResult:      { success: boolean; error?: string } | null = null;
  masterUpResult:    { success: boolean; pushed?: number; error?: string } | null = null;
  transactionResult: { success: boolean; synced?: number; error?: string } | null = null;

  isOnline = navigator.onLine;
  terminalCode: string;
  terminalId: number | null = null;

  // Admin settings edit
  isAdmin = false;
  adminPin = '';
  adminError = '';
  editInterval = 10;
  editAutoSync = true;
  savingSettings = false;

  constructor(
    private sync: SyncService,
    private api: ApiService,
    private db: DatabaseService,
    private terminal: TerminalService,
    private cdr: ChangeDetectorRef
  ) {
    this.terminalCode = terminal.getTerminalCode();
  }

  ngOnInit(): void {
    window.addEventListener('online',  () => { this.isOnline = true;  this.cdr.detectChanges(); });
    window.addEventListener('offline', () => { this.isOnline = false; this.cdr.detectChanges(); });
    this.refresh();
  }

  async refresh(): Promise<void> {
    this.state = this.sync.getState();
    await Promise.all([this.loadLogs(), this.loadSettings(), this.loadPendingCount()]);
    this.cdr.detectChanges();
  }

  private async loadPendingCount(): Promise<void> {
    try {
      const orders = await this.db.getOrders(0, 500);
      this.state.pendingOrderCount = orders.filter(
        o => o.sync_status === 'pending' || o.sync_status === 'failed'
      ).length;
    } catch {}
    await this.sync.refreshPendingMasterCount();
    this.state.pendingMasterCount = this.sync.getState().pendingMasterCount;
  }

  async loadLogs(): Promise<void> {
    try {
      this.logs = await this.db.getSyncLog() as ApiSyncLog[];
    } catch { this.logs = []; }
  }

  async loadSettings(): Promise<void> {
    try {
      this.settings     = await this.db.getSyncSettings();
      this.editInterval = this.settings!.sync_interval_minutes;
      this.editAutoSync = this.settings!.auto_sync_enabled;
    } catch {}
  }

  /** Pull master data from cloud → local */
  async doMasterSync(): Promise<void> {
    this.syncingMaster = true;
    this.masterResult  = null;
    this.masterResult  = await this.sync.syncMasterData();
    this.syncingMaster = false;
    await this.refresh();
  }

  /** Push local master changes → cloud */
  async doMasterSyncUp(): Promise<void> {
    this.syncingMasterUp = true;
    this.masterUpResult  = null;
    this.masterUpResult  = await this.sync.syncMasterDataUp();
    this.syncingMasterUp = false;
    await this.refresh();
  }

  async doTransactionSync(): Promise<void> {
    this.syncingTransaction = true;
    this.transactionResult  = null;
    this.transactionResult  = await this.sync.syncTransactions();
    this.syncingTransaction = false;
    await this.refresh();
  }

  /** Full sync: push local master up, pull cloud master down, push transactions */
  async doFullSync(): Promise<void> {
    this.syncingMaster = true;
    this.syncingTransaction = true;
    await this.sync.syncMasterDataUp();
    await this.sync.syncMasterData();
    await this.sync.syncTransactions();
    this.syncingMaster = false;
    this.syncingTransaction = false;
    await this.refresh();
  }

  unlockAdmin(): void {
    if (this.adminPin === '1234') {
      this.isAdmin   = true;
      this.adminError = '';
    } else {
      this.adminError = 'Invalid PIN';
    }
    this.adminPin = '';
  }

  async saveSettings(): Promise<void> {
    this.savingSettings = true;
    try {
      if (useLocalDb()) {
        await this.db.updateSetting('sync_interval_minutes', String(this.editInterval));
        await this.db.updateSetting('auto_sync_enabled', String(this.editAutoSync));
      } else {
        await this.api.updateSyncSettings({
          sync_interval_minutes: this.editInterval,
          auto_sync_enabled:     this.editAutoSync,
        });
      }
      await this.sync.startAutoSync();
      await this.loadSettings();
    } catch {}
    this.savingSettings = false;
    this.cdr.detectChanges();
  }

  formatDate(iso: string | null): string {
    if (!iso) return 'Never';
    const d = new Date(iso);
    return d.toLocaleString();
  }

  timeSince(iso: string | null): string {
    if (!iso) return '';
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1)   return 'just now';
    if (mins < 60)  return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)   return `${hrs} hr ago`;
    return `${Math.floor(hrs / 24)} days ago`;
  }
}
