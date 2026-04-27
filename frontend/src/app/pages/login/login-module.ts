import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LoginRoutingModule } from './login-routing-module';
import { Login } from './login';

@NgModule({
  declarations: [Login],
  imports: [CommonModule, FormsModule, LoginRoutingModule]
})
export class LoginModule { }
