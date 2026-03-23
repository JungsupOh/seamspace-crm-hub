export interface ContactFields {
  Name?: string;
  Email?: string;
  Phone?: string;
  phone_normalized?: string;
  Org_Name?: string;
  Country?: string;
  Contact_Type?: string;
  Lead_Stage?: string;
  Role?: string;
  Lead_Source?: string;
  data_source_date?: string;
  Notes?: string;

  // 학교 정보 (아래 필드는 Airtable base에 직접 생성 필요)
  School_ID_Number?: string;
  Org_ZipCode?: string;
  Org_Address?: string;
  Org_Address_Detail?: string;
  Org_Tel?: string;
  Org_Homepage?: string;
  Education_Office?: string;
}

export interface DealFields {
  Deal_Name?: string;
  Deal_Stage?: string;
  Deal_Type?: string;             // New | Renewal

  // 담당자
  Contact_Name?: string;
  Contact_Phone?: string;
  Contact_Email?: string;

  // 기관
  Org_Name?: string;
  Admin_Name?: string;
  Admin_Phone?: string;
  Admin_Email?: string;
  School_ID_Number?: string;
  Org_ZipCode?: string;
  Org_Address?: string;
  Org_Address_Detail?: string;
  Org_Tel?: string;
  Org_Homepage?: string;
  Education_Office?: string;

  // 견적
  Quote_Date?: string;
  Quote_Qty?: number;
  Quote_Plan?: string;
  Quote_Number?: string;
  License_Duration?: number;
  Unit_Price?: number;
  List_Price?: number;
  Supply_Price?: number;
  Tax_Amount?: number;
  Final_Contract_Value?: number;

  // 이용권
  License_Code_Count?: number;
  License_Send_Date?: string;
  Renewal_Date?: string;

  // 세무
  Lead_Source?: string;
  Order_Date?: string;
  Contract_Date?: string;
  Payment_Date?: string;
  Receipt_Date?: string;

  // 기타
  Expected_Close_Date?: string;
  Lost_Competitor?: string;
  Assigned_To?: string;
  Notes?: string;
  Created_Date?: string;
}
