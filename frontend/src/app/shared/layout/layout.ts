import { Component, OnInit, HostListener } from '@angular/core';
import { AuthService } from '../../services/auth';
import { ThemeService } from '../../services/theme';
import { SyncService } from '../../services/sync';
import { TerminalService } from '../../services/terminal';

@Component({
  selector: 'app-layout',
  standalone: false,
  templateUrl: './layout.html',
  styleUrls: ['./layout.scss']
})
export class Layout implements OnInit {
  isOnline  = navigator.onLine;
  menuOpen  = false;
  pendingOrders = 0;

  constructor(
    public auth: AuthService,
    private theme: ThemeService,
    private sync: SyncService,
    private terminal: TerminalService,
  ) {}

  ngOnInit(): void {
    window.addEventListener('online',  () => { this.isOnline = true;  this.onOnline(); });
    window.addEventListener('offline', () => { this.isOnline = false; });
    this.refreshPending();
  }

  private onOnline(): void {
    this.sync.syncAll();
    this.terminal.heartbeat();
  }

  private refreshPending(): void {
    this.pendingOrders = this.sync.getState().pendingOrderCount;
  }

  @HostListener('window:resize')
  onResize() { if (window.innerWidth > 768) this.menuOpen = false; }

  showServerInput = false;
  serverUrl       = localStorage.getItem('api_url') || '';

  get isDark()          { return this.theme.isDark(); }
  get isNativeMobile()  { return !!(window as any).Capacitor?.isNativePlatform?.(); }
  get terminalCode()    { return this.terminal.getTerminalCode(); }
  get apiHost() {
    const u = localStorage.getItem('api_url');
    if (u) return u.replace('/api', '');
    return 'localhost:8000';
  }

  toggleDark() { this.theme.toggle(); }
  toggleMenu() { this.menuOpen = !this.menuOpen; }
  closeMenu()  { this.menuOpen = false; }

  saveServerUrl(): void {
    const url = this.serverUrl.trim();
    if (url) {
      const base = url.startsWith('http') ? url.replace(/\/api\/?$/, '') : `https://${url}`;
      localStorage.setItem('api_url', `${base}/api`);
    } else {
      localStorage.removeItem('api_url');
    }
    this.showServerInput = false;
    window.location.reload();
  }

  openCustomerDisplay(): void {
    const electronAPI = (window as any).electronAPI;
    const href = window.location.href.split('#')[0];
    const dir  = href.endsWith('/') ? href : href.slice(0, href.lastIndexOf('/') + 1);
    const htmlUrl = dir + 'customer-display.html';

    if (electronAPI?.openWindow) {
      electronAPI.openWindow(htmlUrl);
    } else if (electronAPI?.isElectron) {
      window.open(htmlUrl, 'customer_display', 'width=1280,height=800,toolbar=no,menubar=no');
    } else {
      window.open(`${href}#/customer-display`, 'customer_display', 'width=1280,height=800,toolbar=no,menubar=no');
    }
  }

  logout(): void { this.auth.logout(); }
}
