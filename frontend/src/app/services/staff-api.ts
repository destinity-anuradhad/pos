import { Injectable } from '@angular/core';
import { ApiService, ApiStaff } from './api';

export type { ApiStaff as Staff };

@Injectable({ providedIn: 'root' })
export class StaffApiService {
  constructor(private api: ApiService) {}

  list(): Promise<ApiStaff[]>                                              { return this.api.getStaff(); }
  create(data: { display_name: string; username: string; role: string; pin?: string; password?: string }): Promise<ApiStaff> {
    return this.api.createStaff(data);
  }
  update(id: number, data: Partial<{ display_name: string; username: string; role: string; is_active: boolean }>): Promise<ApiStaff> {
    return this.api.updateStaff(id, data);
  }
  changePin(id: number, pin: string): Promise<any>                        { return this.api.changeStaffPin(id, pin); }
  deactivate(id: number): Promise<void>                                   { return this.api.deleteStaff(id); }
}
