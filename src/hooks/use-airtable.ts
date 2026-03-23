import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { airtable } from '@/lib/airtable';
import { ContactFields, DealFields } from '@/types/airtable';

export function useContacts() {
  return useQuery({
    queryKey: ['contacts'],
    queryFn: () => airtable.fetchAll<ContactFields>('01_Contacts'),
    staleTime: 0,
    refetchOnMount: true,
  });
}

export function useDeals() {
  return useQuery({
    queryKey: ['deals'],
    queryFn: () => airtable.fetchAll<DealFields>('03_Deals'),
    staleTime: 0,
    refetchOnMount: true,
  });
}

export function useCreateContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fields: Partial<ContactFields>) => airtable.createRecord<ContactFields>('01_Contacts', fields),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts'] }),
  });
}

export function useUpdateContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, fields }: { id: string; fields: Partial<ContactFields> }) =>
      airtable.updateRecord<ContactFields>('01_Contacts', id, fields),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts'] }),
  });
}

export function useCreateDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fields: Partial<DealFields>) => airtable.createRecord<DealFields>('03_Deals', fields),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deals'] }),
  });
}

export function useUpdateDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, fields }: { id: string; fields: Partial<DealFields> }) =>
      airtable.updateRecord<DealFields>('03_Deals', id, fields),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deals'] }),
  });
}

export function useDeleteDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => airtable.deleteRecord('03_Deals', id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deals'] }),
  });
}

export function useDeleteContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => airtable.deleteRecord('01_Contacts', id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts'] }),
  });
}
