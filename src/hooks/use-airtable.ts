import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { airtable, AirtableRecord } from '@/lib/airtable';
import { ContactFields, DealFields, OrganizationFields, TrialFields } from '@/types/airtable';

export function useContacts() {
  return useQuery({
    queryKey: ['contacts'],
    queryFn: () => airtable.fetchAll<ContactFields>('01_Contacts'),
  });
}

export function useDeals() {
  return useQuery({
    queryKey: ['deals'],
    queryFn: () => airtable.fetchAll<DealFields>('03_Deals'),
  });
}

export function useOrganizations() {
  return useQuery({
    queryKey: ['organizations'],
    queryFn: () => airtable.fetchAll<OrganizationFields>('02_Organizations'),
  });
}

export function useTrials() {
  return useQuery({
    queryKey: ['trials'],
    queryFn: () => airtable.fetchAll<TrialFields>('05_Trial_PQL'),
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
