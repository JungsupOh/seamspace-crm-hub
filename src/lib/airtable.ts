import { supabase } from '@/integrations/supabase/client';

export interface AirtableRecord<T> {
  id: string;
  fields: T;
  createdTime: string;
}

async function fetchAll<T>(tableName: string, params?: Record<string, string>): Promise<AirtableRecord<T>[]> {
  const { data, error } = await supabase.functions.invoke('airtable-proxy', {
    body: { table: tableName, method: 'GET', params },
  });

  if (error) throw new Error(`Airtable proxy error: ${error.message}`);
  return data.records;
}

async function createRecord<T>(tableName: string, fields: Partial<T>): Promise<AirtableRecord<T>> {
  const { data, error } = await supabase.functions.invoke('airtable-proxy', {
    body: { table: tableName, method: 'POST', fields },
  });

  if (error) throw new Error(`Airtable create error: ${error.message}`);
  return data;
}

async function updateRecord<T>(tableName: string, recordId: string, fields: Partial<T>): Promise<AirtableRecord<T>> {
  const { data, error } = await supabase.functions.invoke('airtable-proxy', {
    body: { table: tableName, method: 'PATCH', recordId, fields },
  });

  if (error) throw new Error(`Airtable update error: ${error.message}`);
  return data;
}

export const airtable = { fetchAll, createRecord, updateRecord };
