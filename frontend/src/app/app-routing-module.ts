import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { HashLocationStrategy, LocationStrategy } from '@angular/common';
import { authGuard } from './guards/auth-guard';
import { modeGuard } from './guards/mode-guard';

const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  {
    path: 'login',
    loadChildren: () => import('./pages/login/login-module').then(m => m.LoginModule)
  },
  {
    path: 'mode-select',
    canActivate: [authGuard],
    loadChildren: () => import('./pages/mode-select/mode-select-module').then(m => m.ModeSelectModule)
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
    path: 'customer-display',
    loadChildren: () => import('./pages/customer-display/customer-display-module').then(m => m.CustomerDisplayModule)
  },
  { path: '**', redirectTo: 'dashboard' }
];

@NgModule({
  imports: [RouterModule.forRoot(routes, { useHash: true })],
  exports: [RouterModule],
  providers: [{ provide: LocationStrategy, useClass: HashLocationStrategy }]
})
export class AppRoutingModule { }
