import { supabase } from '@/lib/supabase';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export interface AirtableRecord<T> {
  id: string;
  fields: T;
  createdTime: string;
}

async function getAccessToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('로그인이 필요합니다');
  return session.access_token;
}

async function callProxy(body: Record<string, unknown>): Promise<unknown> {
  const token = await getAccessToken();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/airtable-proxy`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || `Proxy error: ${res.status} ${res.statusText}`);
  }
  return data;
}

async function fetchAll<T>(tableName: string, params?: Record<string, string>): Promise<AirtableRecord<T>[]> {
  const data = await callProxy({ action: 'fetchAll', table: tableName, params }) as { records: AirtableRecord<T>[] };
  return data.records;
}

async function createRecord<T>(tableName: string, fields: Partial<T>): Promise<AirtableRecord<T>> {
  return await callProxy({ action: 'createRecord', table: tableName, fields }) as AirtableRecord<T>;
}

async function updateRecord<T>(tableName: string, recordId: string, fields: Partial<T>): Promise<AirtableRecord<T>> {
  return await callProxy({ action: 'updateRecord', table: tableName, recordId, fields }) as AirtableRecord<T>;
}

async function deleteRecord(tableName: string, recordId: string): Promise<void> {
  await callProxy({ action: 'deleteRecord', table: tableName, recordId });
}

// 최대 10건씩 배치 생성 (Airtable API 제한)
async function createBatch<T>(tableName: string, fieldsList: Partial<T>[]): Promise<AirtableRecord<T>[]> {
  const data = await callProxy({
    action: 'createBatch',
    table: tableName,
    records: fieldsList.map(fields => ({ fields })),
  }) as { records: AirtableRecord<T>[] };
  return data.records;
}

// 최대 10건씩 배치 수정 (Airtable API 제한)
async function updateBatch<T>(tableName: string, updates: { id: string; fields: Partial<T> }[]): Promise<void> {
  await callProxy({ action: 'updateBatch', table: tableName, updates });
}

export const airtable = { fetchAll, createRecord, createBatch, updateRecord, updateBatch, deleteRecord };
