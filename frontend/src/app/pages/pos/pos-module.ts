import { NgModule } from '@angular/core';
import { PosRoutingModule } from './pos-routing-module';
import { Pos } from './pos';
import { SharedModule } from '../../shared/shared/shared-module';

@NgModule({
  declarations: [Pos],
  imports: [SharedModule, PosRoutingModule],
})
export class PosModule {}
