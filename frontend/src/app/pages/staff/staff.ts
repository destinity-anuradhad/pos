import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { StaffApiService } from '../../services/staff-api';
import { ApiStaff } from '../../services/api';

@Component({
  selector: 'app-staff',
  standalone: false,
  templateUrl: './staff.html',
  styleUrls: ['./staff.scss']
})
export class StaffPage implements OnInit {
  staffList: ApiStaff[] = [];
  loading = true;
  error = '';
  showForm = false;
  editingId: number | null = null;
  form = { display_name: '', username: '', role: 'cashier', pin: '', password: '', confirmCredential: '' };
  formError = '';
  saving = false;

  readonly ROLES = ['cashier', 'manager', 'admin'];
  readonly ROLE_LABELS: Record<string, string> = { cashier: 'Cashier', manager: 'Manager', admin: 'Admin' };
  readonly ROLE_COLORS: Record<string, string> = { cashier: '#22c55e', manager: '#f59e0b', admin: '#ef4444' };

  get isCashierForm(): boolean { return this.form.role === 'cashier'; }

  constructor(private api: StaffApiService, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void { this.load(); }

  async load(): Promise<void> {
    this.loading = true;
    try {
      this.staffList = await this.api.list();
    } catch (e: any) {
      this.error = e.message || 'Failed to load staff';
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  openAdd(): void {
    this.editingId = null;
    this.form = { display_name: '', username: '', role: 'cashier', pin: '', password: '', confirmCredential: '' };
    this.formError = '';
    this.showForm = true;
  }

  openEdit(s: ApiStaff): void {
    this.editingId = s.id;
    this.form = { display_name: s.display_name, username: s.username, role: s.role, pin: '', password: '', confirmCredential: '' };
    this.formError = '';
    this.showForm = true;
  }

  async save(): Promise<void> {
    this.formError = '';
    if (!this.form.display_name.trim()) { this.formError = 'Display name is required'; return; }
    if (!this.form.username.trim()) { this.formError = 'Username is required'; return; }

    const credential = this.isCashierForm ? this.form.pin : this.form.password;
    if (!this.editingId && !credential) {
      this.formError = this.isCashierForm ? 'PIN is required' : 'Password is required'; return;
    }
    if (credential) {
      if (this.isCashierForm && credential.length < 4) { this.formError = 'PIN must be at least 4 digits'; return; }
      if (!this.isCashierForm && credential.length < 6) { this.formError = 'Password must be at least 6 characters'; return; }
      if (credential !== this.form.confirmCredential) {
        this.formError = this.isCashierForm ? 'PINs do not match' : 'Passwords do not match'; return;
      }
    }

    this.saving = true;
    try {
      if (this.editingId) {
        const payload: any = { display_name: this.form.display_name.trim(), username: this.form.username.trim(), role: this.form.role };
        if (credential) {
          if (this.isCashierForm) {
            await this.api.changePin(this.editingId, credential);
          } else {
            payload.password = credential;
          }
        }
        await this.api.update(this.editingId, payload);
      } else {
        const payload: any = { display_name: this.form.display_name.trim(), username: this.form.username.trim(), role: this.form.role };
        if (this.isCashierForm) payload.pin = credential;
        else payload.password = credential;
        await this.api.create(payload);
      }
      this.showForm = false;
      await this.load();
    } catch (e: any) {
      this.formError = e.message || 'Failed to save';
    } finally {
      this.saving = false;
      this.cdr.detectChanges();
    }
  }

  async deactivate(s: ApiStaff): Promise<void> {
    if (!confirm(`Deactivate ${s.display_name}?`)) return;
    try {
      await this.api.deactivate(s.id);
      await this.load();
    } catch (e: any) {
      alert(e.message);
    }
  }

  async reactivate(s: ApiStaff): Promise<void> {
    try {
      await this.api.update(s.id, { is_active: true });
      await this.load();
    } catch (e: any) {
      alert(e.message);
    }
  }

  isLocked(s: ApiStaff): boolean {
    if (!s.locked_until) return false;
    return new Date(s.locked_until) > new Date();
  }
}
