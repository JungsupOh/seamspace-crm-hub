export interface ContactFields {
  Name?: string;
  Email?: string;
  Phone?: string;
  Organization?: string[] | string;
  Country?: string;
  Contact_Type?: string;
  MQL_Score?: number;
  MQL_Grade?: string;
  Champion_Score?: number;
  Next_Followup_Date?: string;
  Assigned_To?: string;
  Role?: string;
  Lead_Source?: string;
  Notes?: string;
  Created_Date?: string;
}

export interface DealFields {
  Deal_Name?: string;
  Deal_Stage?: string;
  Deal_Type?: string;
  Organization?: string[] | string;
  Keyman_Contact?: string[] | string;
  MQL_Grade?: string;
  Expected_Close_Date?: string;
  Assigned_To?: string;
  Deal_Value?: number;
  Notes?: string;
  Created_Date?: string;
}

export interface OrganizationFields {
  Org_Name?: string;
  Country?: string;
  Type?: string;
  Student_Count?: number;
  Active_License?: string;
  Health_Score?: number;
  Health_Grade?: string;
  Renewal_Date?: string;
  Notes?: string;
}

export interface TrialFields {
  Coupon_Code?: string;
  Contact?: string[] | string;
  PQL_Score?: number;
  PQL_Grade?: string;
  Lessons_Created?: number;
  Students_Invited?: number;
  Trial_Result?: string;
  Expiration_Date?: string;
  Days_Until_Expiry?: number;
}
