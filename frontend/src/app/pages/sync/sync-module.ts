import { NgModule } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { SyncPage } from './sync-page';
import { SharedModule } from '../../shared/shared/shared-module';

@NgModule({
  declarations: [SyncPage],
  imports: [
    SharedModule,
    FormsModule,
    RouterModule.forChild([{ path: '', component: SyncPage }])
  ]
})
export class SyncModule {}
