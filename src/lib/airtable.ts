const BASE_URL = `https://api.airtable.com/v0/${import.meta.env.VITE_AIRTABLE_BASE_ID || 'appsnsExBG8ZeEZEk'}`;
const TOKEN = import.meta.env.VITE_AIRTABLE_TOKEN || '';

interface AirtableResponse<T> {
  records: AirtableRecord<T>[];
  offset?: string;
}

export interface AirtableRecord<T> {
  id: string;
  fields: T;
  createdTime: string;
}

async function fetchAll<T>(tableName: string, params?: Record<string, string>): Promise<AirtableRecord<T>[]> {
  const allRecords: AirtableRecord<T>[] = [];
  let offset: string | undefined;

  do {
    const searchParams = new URLSearchParams({ pageSize: '100', ...params });
    if (offset) searchParams.set('offset', offset);

    const res = await fetch(`${BASE_URL}/${encodeURIComponent(tableName)}?${searchParams}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });

    if (!res.ok) {
      throw new Error(`Airtable error: ${res.status} ${res.statusText}`);
    }

    const data: AirtableResponse<T> = await res.json();
    allRecords.push(...data.records);
    offset = data.offset;
  } while (offset);

  return allRecords;
}

async function parseError(res: Response, prefix: string): Promise<never> {
  const body = await res.json().catch(() => ({}));
  const msg = body?.error?.message || body?.message || `${res.status} ${res.statusText}`;
  throw new Error(`[${prefix}] ${msg}`);
}

async function createRecord<T>(tableName: string, fields: Partial<T>): Promise<AirtableRecord<T>> {
  const res = await fetch(`${BASE_URL}/${encodeURIComponent(tableName)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) await parseError(res, 'create');
  return res.json();
}

async function updateRecord<T>(tableName: string, recordId: string, fields: Partial<T>): Promise<AirtableRecord<T>> {
  const res = await fetch(`${BASE_URL}/${encodeURIComponent(tableName)}/${recordId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) await parseError(res, 'update');
  return res.json();
}

async function deleteRecord(tableName: string, recordId: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/${encodeURIComponent(tableName)}/${recordId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!res.ok) await parseError(res, 'delete');
}

// 최대 10건씩 배치 생성 (Airtable API 제한)
async function createBatch<T>(tableName: string, fieldsList: Partial<T>[]): Promise<AirtableRecord<T>[]> {
  const res = await fetch(`${BASE_URL}/${encodeURIComponent(tableName)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ records: fieldsList.map(fields => ({ fields })) }),
  });
  if (!res.ok) await parseError(res, 'create');
  const data: AirtableResponse<T> = await res.json();
  return data.records;
}

// 최대 10건씩 배치 수정 (Airtable API 제한)
async function updateBatch<T>(tableName: string, updates: { id: string; fields: Partial<T> }[]): Promise<void> {
  for (let i = 0; i < updates.length; i += 10) {
    const chunk = updates.slice(i, i + 10);
    const res = await fetch(`${BASE_URL}/${encodeURIComponent(tableName)}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: chunk.map(u => ({ id: u.id, fields: u.fields })) }),
    });
    if (!res.ok) await parseError(res, 'updateBatch');
  }
}

export const airtable = { fetchAll, createRecord, createBatch, updateRecord, updateBatch, deleteRecord };
