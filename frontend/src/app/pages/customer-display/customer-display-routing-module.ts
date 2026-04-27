import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { CustomerDisplay } from './customer-display';

const routes: Routes = [{ path: '', component: CustomerDisplay }];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class CustomerDisplayRoutingModule {}
