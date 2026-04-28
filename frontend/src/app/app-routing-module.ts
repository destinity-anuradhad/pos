import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { HashLocationStrategy, LocationStrategy } from '@angular/common';
import { authGuard } from './guards/auth-guard';
import { roleGuard } from './guards/role-guard';
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
    canActivate: [authGuard, roleGuard, modeGuard],
    data: { roles: ['manager', 'admin'] },
    loadChildren: () => import('./pages/products/products-module').then(m => m.ProductsModule)
  },
  {
    path: 'categories',
    canActivate: [authGuard, roleGuard, modeGuard],
    data: { roles: ['manager', 'admin'] },
    loadChildren: () => import('./pages/categories/categories-module').then(m => m.CategoriesModule)
  },
  {
    path: 'pos',
    canActivate: [modeGuard],
    loadChildren: () => import('./pages/pos/pos-module').then(m => m.PosModule)
  },
  {
    path: 'orders',
    canActivate: [authGuard, roleGuard, modeGuard],
    data: { roles: ['manager', 'admin'] },
    loadChildren: () => import('./pages/orders/orders-module').then(m => m.OrdersModule)
  },
  {
    path: 'sync',
    canActivate: [authGuard, roleGuard, modeGuard],
    data: { roles: ['manager', 'admin'] },
    loadChildren: () => import('./pages/sync/sync-module').then(m => m.SyncModule)
  },
  {
    path: 'tables',
    canActivate: [authGuard, roleGuard, modeGuard],
    data: { roles: ['manager', 'admin'] },
    loadChildren: () => import('./pages/tables/tables-module').then(m => m.TablesModule)
  },
  {
    path: 'staff',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['admin'] },
    loadChildren: () => import('./pages/staff/staff-module').then(m => m.StaffModule)
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
