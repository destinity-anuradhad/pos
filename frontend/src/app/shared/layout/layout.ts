import { Component, OnInit, HostListener } from '@angular/core';
import { AuthService } from '../../services/auth';
import { AppModeService } from '../../services/app-mode';
import { ThemeService } from '../../services/theme';
import { Router } from '@angular/router';

@Component({
  selector: 'app-layout',
  standalone: false,
  templateUrl: './layout.html',
  styleUrls: ['./layout.scss']
})
export class Layout implements OnInit {
  isOnline = navigator.onLine;
  menuOpen = false;

  constructor(
    private auth: AuthService,
    private modeService: AppModeService,
    private theme: ThemeService,
    private router: Router
  ) {}

  ngOnInit(): void {
    window.addEventListener('online',  () => this.isOnline = true);
    window.addEventListener('offline', () => this.isOnline = false);
  }

  @HostListener('window:resize')
  onResize() {
    if (window.innerWidth > 768) this.menuOpen = false;
  }

  get mode()        { return this.modeService.getMode(); }
  get isRestaurant(){ return this.modeService.isRestaurant(); }
  get modeLabel()   { return this.isRestaurant ? '🍽️ Restaurant' : '🛍️ Retail Shop'; }
  get isDark()      { return this.theme.isDark(); }

  toggleDark()  { this.theme.toggle(); }
  toggleMenu()  { this.menuOpen = !this.menuOpen; }
  closeMenu()   { this.menuOpen = false; }

  switchMode(): void {
    this.modeService.clearMode();
    this.router.navigate(['/mode-select']);
  }

  logout(): void {
    this.auth.logout();
  }
}
