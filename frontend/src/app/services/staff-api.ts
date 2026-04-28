import { Injectable } from '@angular/core';
import { AuthService } from './auth';

export interface Staff {
  id: number;
  name: string;
  role: string;
  is_active: boolean;
  created_at: string;
}

@Injectable({ providedIn: 'root' })
export class StaffApiService {
  constructor(private auth: AuthService) {}

  private get _base(): string {
    return (localStorage.getItem('api_url') || 'http://localhost:8000/api');
  }

  private get _headers(): HeadersInit {
    const token = this.auth.getToken();
    return {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    };
  }

  async list(): Promise<Staff[]> {
    const res = await fetch(`${this._base}/staff/`, { headers: this._headers });
    if (!res.ok) throw new Error('Failed to load staff');
    return res.json();
  }

  async create(data: { name: string; role: string; pin: string }): Promise<Staff> {
    const res = await fetch(`${this._base}/staff/`, {
      method: 'POST',
      headers: this._headers,
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Failed to create staff');
    return json;
  }

  async update(id: number, data: Partial<{ name: string; role: string; pin: string; is_active: boolean }>): Promise<Staff> {
    const res = await fetch(`${this._base}/staff/${id}`, {
      method: 'PUT',
      headers: this._headers,
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Failed to update staff');
    return json;
  }

  async deactivate(id: number): Promise<void> {
    const res = await fetch(`${this._base}/staff/${id}`, {
      method: 'DELETE',
      headers: this._headers,
    });
    if (!res.ok) {
      const json = await res.json();
      throw new Error(json.error || 'Failed to deactivate staff');
    }
  }
}
