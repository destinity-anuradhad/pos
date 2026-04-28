import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { HashLocationStrategy, LocationStrategy } from '@angular/common';
import { authGuard } from './guards/auth-guard';
import { modeGuard } from './guards/mode-guard';
import { CustomerDisplayModule } from './pages/customer-display/customer-display-module';

const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  {
    path: 'login',
    loadChildren: () => import('./pages/login/login-module').then(m => m.LoginModule)
  },
  {
    path: 'terminal-setup',
    canActivate: [authGuard],
    loadChildren: () => import('./pages/terminal-setup/terminal-setup-module').then(m => m.TerminalSetupModule)
  },
  {
    path: 'dashboard',
    canActivate: [modeGuard],
    loadChildren: () => import('./pages/dashboard/dashboard-module').then(m => m.DashboardModule)
  },
  {
    path: 'products',
    canActivate: [modeGuard],
    loadChildren: () => import('./pages/products/products-module').then(m => m.ProductsModule)
  },
  {
    path: 'pos',
    canActivate: [modeGuard],
    loadChildren: () => import('./pages/pos/pos-module').then(m => m.PosModule)
  },
  {
    path: 'orders',
    canActivate: [modeGuard],
    loadChildren: () => import('./pages/orders/orders-module').then(m => m.OrdersModule)
  },
  {
    path: 'sync',
    canActivate: [modeGuard],
    loadChildren: () => import('./pages/sync/sync-module').then(m => m.SyncModule)
  },
  {
    path: 'customer-display',
    loadChildren: () => Promise.resolve(CustomerDisplayModule)
  },
  { path: '**', redirectTo: 'dashboard' }
];

@NgModule({
  imports: [RouterModule.forRoot(routes, { useHash: true })],
  exports: [RouterModule],
  providers: [{ provide: LocationStrategy, useClass: HashLocationStrategy }]
})
export class AppRoutingModule { }
