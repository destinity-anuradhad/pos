import { NgModule } from '@angular/core';
import { TablesRoutingModule } from './tables-routing-module';
import { TablesPage } from './tables';
import { SharedModule } from '../../shared/shared/shared-module';

@NgModule({
  declarations: [TablesPage],
  imports: [TablesRoutingModule, SharedModule]
})
export class TablesModule {}
