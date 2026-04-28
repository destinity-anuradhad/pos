import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { SyncService, SyncState } from '../../services/sync';
import { ApiService, ApiSyncLog, SyncSettings } from '../../services/api';
import { TerminalService } from '../../services/terminal';

@Component({
  selector: 'app-sync-page',
  standalone: false,
  templateUrl: './sync-page.html',
  styleUrls: ['./sync-page.scss']
})
export class SyncPage implements OnInit {
  state!: SyncState;
  logs: ApiSyncLog[] = [];
  settings: SyncSettings | null = null;

  syncingMaster      = false;
  syncingTransaction = false;
  masterResult:      { success: boolean; error?: string } | null = null;
  transactionResult: { success: boolean; synced?: number; error?: string } | null = null;

  isOnline = navigator.onLine;
  terminalCode: string;
  terminalId: number | null;

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
    private terminal: TerminalService,
    private cdr: ChangeDetectorRef
  ) {
    this.terminalCode = terminal.getTerminalCode();
    this.terminalId   = terminal.getTerminalId();
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

  /** Count orders in local SQLite that still need to be synced to cloud */
  private async loadPendingCount(): Promise<void> {
    try {
      const orders = await this.api.getOrders(0, 500);
      // Mutate the existing state object rather than replacing it, so concurrent
      // async operations in refresh() don't inadvertently wipe lastTransactionSync.
      this.state.pendingOrderCount = orders.filter(
        o => o.sync_status === 'pending' || o.sync_status === 'failed'
      ).length;
    } catch {}
  }

  async loadLogs(): Promise<void> {
    try {
      this.logs = await this.api.getSyncLog(this.terminalId || undefined);
    } catch { this.logs = []; }
  }

  async loadSettings(): Promise<void> {
    try {
      this.settings    = await this.api.getSyncSettings();
      this.editInterval = this.settings.sync_interval_minutes;
      this.editAutoSync = this.settings.auto_sync_enabled;
    } catch {}
  }

  async doMasterSync(): Promise<void> {
    this.syncingMaster = true;
    this.masterResult  = null;
    this.masterResult  = await this.sync.syncMasterData();
    this.syncingMaster = false;
    await this.refresh();
  }

  async doTransactionSync(): Promise<void> {
    this.syncingTransaction = true;
    this.transactionResult  = null;
    this.transactionResult  = await this.sync.syncTransactions();
    this.syncingTransaction = false;
    await this.refresh();
  }

  async doFullSync(): Promise<void> {
    this.syncingMaster = true;
    this.syncingTransaction = true;
    // Pull latest master data from cloud, then push pending orders to cloud
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
      await this.api.updateSyncSettings({
        sync_interval_minutes: this.editInterval,
        auto_sync_enabled:     this.editAutoSync,
      });
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
