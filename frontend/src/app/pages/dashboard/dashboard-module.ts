import { NgModule } from '@angular/core';
import { DashboardRoutingModule } from './dashboard-routing-module';
import { Dashboard } from './dashboard';
import { SharedModule } from '../../shared/shared/shared-module';

@NgModule({
  declarations: [Dashboard],
  imports: [SharedModule, DashboardRoutingModule],
})
export class DashboardModule {}
