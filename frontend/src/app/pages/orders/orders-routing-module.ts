import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { Orders } from './orders';

const routes: Routes = [
  { path: '', component: Orders }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class OrdersRoutingModule {}
