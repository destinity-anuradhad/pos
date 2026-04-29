import { NgModule, provideBrowserGlobalErrorListeners, isDevMode } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { AppRoutingModule } from './app-routing-module';
import { App } from './app';
import { LockScreenComponent } from './components/lock-screen/lock-screen';
import { SharedModule } from './shared/shared/shared-module';
import { ServiceWorkerModule } from '@angular/service-worker';

@NgModule({
  declarations: [App, LockScreenComponent],
  imports: [
    BrowserModule,
    CommonModule,
    FormsModule,
    AppRoutingModule,
    SharedModule,

    ServiceWorkerModule.register('ngsw-worker.js', {
      enabled: !isDevMode() && !(window as any).electronAPI?.isElectron,
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
  providers: [provideBrowserGlobalErrorListeners()],
  bootstrap: [App],
})
export class AppModule {}
