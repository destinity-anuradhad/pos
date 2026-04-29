import { Injectable } from '@angular/core';
import { ApiStaff } from './api';
import { DatabaseService } from './database';

export type { ApiStaff as Staff };

@Injectable({ providedIn: 'root' })
export class StaffApiService {
  constructor(private db: DatabaseService) {}

  list(): Promise<ApiStaff[]>  { return this.db.getStaff(); }
  create(data: { display_name: string; username: string; role: string; pin?: string; password?: string }): Promise<ApiStaff> {
    return this.db.createStaff(data);
  }
  update(id: number, data: Partial<{ display_name: string; username: string; role: string; is_active: boolean }>): Promise<ApiStaff> {
    return this.db.updateStaff(id, data);
  }
  changePin(id: number, pin: string): Promise<any>  { return this.db.changeStaffPin(id, pin); }
  deactivate(id: number): Promise<void>             { return this.db.deleteStaff(id); }
}
