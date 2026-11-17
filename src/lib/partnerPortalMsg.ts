// 파트너 포털의 "내 계약" 구역 문구 (LEAD-S7-4)
//
// 기존 `partner-i18n.ts` 의 `Msg`·`makeT` 를 그대로 쓴다(ko 기본, ja·en 폴백).
// 여기 모아 두면 **번역 빠짐을 테스트가 한 곳에서 잡을 수 있다.**
//
// ⚠️ 파트너에게 보여 주는 글이다. 내부 숫자·다른 파트너 정보를 넣지 않는다.

import type { Msg } from '@/lib/partner-i18n';

export const PORTAL_MSG = {
  // ── 구역 제목 ──
  sectionTitle: { ko: '내 계약', ja: '契約', en: 'My contract' },
  balance:      { ko: '잔여 수량', ja: '残り数量', en: 'Remaining' },
  purchased:    { ko: '구매 합계', ja: '購入合計', en: 'Purchased' },
  issued:       { ko: '발급 합계', ja: '発行合計', en: 'Issued' },
  contracted:   { ko: '계약 수량', ja: '契約数量', en: 'Contracted' },
  unitPrice:    { ko: '연간 인원당 단가', ja: '年間1人あたり単価', en: 'Price per seat / year' },
  period:       { ko: '계약 기간', ja: '契約期間', en: 'Contract period' },
  purchases:    { ko: '구매 내역', ja: '購入履歴', en: 'Purchase history' },
  seatMonths:   { ko: '인원·개월', ja: '人月', en: 'seat-months' },

  // ── 청구·입금 ──
  billUnbilled: { ko: '청구 전',    ja: '請求前',   en: 'Not invoiced' },
  billBilled:   { ko: '청구함',     ja: '請求済み', en: 'Invoiced' },
  billPartial:  { ko: '일부 입금',  ja: '一部入金', en: 'Partially paid' },
  billPaid:     { ko: '입금 완료',  ja: '入金済み', en: 'Paid' },
  paidOn:       { ko: '입금일',     ja: '入金日',   en: 'Paid on' },
  invoicedOn:   { ko: '청구일',     ja: '請求日',   en: 'Invoiced on' },

  // ── 잔량 안내 ──
  balanceZero: {
    ko: '보유 수량을 모두 썼습니다. 추가 구매를 요청해 주세요.',
    ja: '残り数量がありません。追加購入をご依頼ください。',
    en: 'You have used all of your seat-months. Please request an additional purchase.',
  },
  balanceNegative: {
    ko: '발급이 보유 수량을 넘었습니다. 담당자에게 문의해 주세요.',
    ja: '発行が保有数量を超えています。担当者にお問い合わせください。',
    en: 'Issued amount exceeds what was purchased. Please contact us.',
  },
  balanceUnknown: {
    // 숫자를 지어내지 않는다 — 셀 수 없으면 셀 수 없다고 말한다.
    ko: '수량을 확인할 수 없는 발급 기록이 있어 잔여 수량을 셀 수 없습니다. 담당자가 확인한 뒤 발급할 수 있습니다.',
    ja: '数量を確認できない発行記録があるため、残り数量を計算できません。担当者の確認後に発行できます。',
    en: 'Some issuance records have an unknown quantity, so we cannot calculate the remaining balance. We will check and get back to you.',
  },
  unpaidOk: {
    ko: '입금 전이어도 발급할 수 있습니다. 미수금은 따로 안내드립니다.',
    ja: '入金前でも発行できます。未入金分は別途ご案内します。',
    en: 'You can issue licenses before payment arrives. We will follow up on anything outstanding.',
  },

  // ── 계약 선택 ──
  chooseContract: {
    ko: '어느 계약에서 발급할까요?',
    ja: 'どの契約から発行しますか？',
    en: 'Which contract should this be issued from?',
  },
  chooseContractRequired: {
    ko: '계약을 선택해 주세요.',
    ja: '契約を選択してください。',
    en: 'Please choose a contract.',
  },
  contractFixed: {
    ko: '이 계약에서 발급됩니다.',
    ja: 'この契約から発行されます。',
    en: 'This will be issued from this contract.',
  },

  // ── 요청 ──
  requestPurchase:  { ko: '추가 구매 요청', ja: '追加購入を依頼', en: 'Request more seats' },
  requestPurchaseHint: {
    ko: '필요한 수량을 적어 보내시면 확인하고 연락드립니다. (바로 청구서가 나가지는 않습니다)',
    ja: '必要な数量をお送りいただければ、確認のうえご連絡します。（すぐに請求書が発行されるわけではありません）',
    en: 'Tell us how much you need and we will get back to you. (No invoice is issued automatically.)',
  },
  requestSeats: { ko: '희망 수량 (선택)', ja: '希望数量（任意）', en: 'How much do you need? (optional)' },
  requestNote:  { ko: '메모 (선택)', ja: 'メモ（任意）', en: 'Note (optional)' },
  requestSend:  { ko: '요청 보내기', ja: '依頼を送る', en: 'Send request' },
  requestOpen:  { ko: '요청을 보냈습니다. 확인 중입니다.', ja: '依頼済みです。確認中です。', en: 'Request sent — we are looking at it.' },

  requestRevoke: { ko: '사용 불가 처리 요청', ja: '利用停止を依頼', en: 'Request to disable' },
  requestRevokeHint: {
    // ⚠️ "껐다"고 오해하지 않게 — 가장 중요한 문구다.
    ko: '이용권을 사용 불가로 표시해 달라는 요청입니다. **이미 발급된 쿠폰이 즉시 꺼지지는 않습니다.** 처리 후 안내드립니다.',
    ja: 'ライセンスを利用停止にする依頼です。**発行済みのクーポンがすぐに無効になるわけではありません。** 処理後にご連絡します。',
    en: 'This asks us to mark the license as unusable. **A coupon that was already issued does not stop working right away.** We will confirm once it is handled.',
  },
  requestReason: { ko: '사유 (선택)', ja: '理由（任意）', en: 'Reason (optional)' },

  // ── 발급 이력 ──
  issuedBy:   { ko: '발급한 계정', ja: '発行アカウント', en: 'Issued by' },
  issuedMe:   { ko: '나', ja: '自分', en: 'You' },
  issuedOther:{ ko: '같은 회사의 다른 계정', ja: '同じ会社の別アカウント', en: 'Another account at your company' },
  issuedUs:   { ko: '담당자(우리)', ja: '担当者（当社）', en: 'Our team' },
  fromContract: { ko: '계약', ja: '契約', en: 'Contract' },
  notLinked:  {
    ko: '계약 전 발급 (연결 안 됨)',
    ja: '契約前の発行（未リンク）',
    en: 'Issued before contracts (not linked)',
  },
} as const satisfies Record<string, Msg>;

export type PortalMsgKey = keyof typeof PORTAL_MSG;

// ── 서버가 돌려주는 거절 코드 → 파트너 말 ──
//
// 서버(`partner-issue-license`)도 자기 문구를 보내지만, 포털은 **코드로** 받아
// 여기서 고른다. 서버 문구가 영어·한국어뿐이라 일본어가 빠지고,
// 화면 맥락(어느 계약인지)을 덧붙일 수 있기 때문이다.
export const ISSUE_BLOCK_MSG = {
  INSUFFICIENT_BALANCE: {
    ko: '보유 수량이 모자랍니다. 추가 구매를 요청해 주세요.',
    ja: '残り数量が足りません。追加購入をご依頼ください。',
    en: 'You do not have enough seat-months left. Please request an additional purchase.',
  },
  UNKNOWN_HISTORY: {
    ko: '수량을 확인할 수 없는 발급 기록이 있어 발급할 수 없습니다. 담당자가 확인한 뒤 안내드립니다.',
    ja: '数量を確認できない発行記録があるため発行できません。担当者の確認後にご案内します。',
    en: 'We cannot issue right now because some records have an unknown quantity. We will check and get back to you.',
  },
  CONTRACT_EXPIRED: {
    ko: '계약 기간이 끝났습니다. 담당자에게 문의해 주세요.',
    ja: '契約期間が終了しています。担当者にお問い合わせください。',
    en: 'This contract has ended. Please contact us.',
  },
  CONTRACT_NOT_ACTIVE: {
    ko: '유효한 계약이 아닙니다. 담당자에게 문의해 주세요.',
    ja: '有効な契約ではありません。担当者にお問い合わせください。',
    en: 'This contract is not active. Please contact us.',
  },
  CONTRACT_REQUIRED: {
    ko: '어느 계약에서 발급할지 선택해 주세요.',
    ja: 'どの契約から発行するか選択してください。',
    en: 'Please choose which contract to issue from.',
  },
  NO_CONTRACT: {
    ko: '계약을 찾을 수 없습니다. 담당자에게 문의해 주세요.',
    ja: '契約が見つかりません。担当者にお問い合わせください。',
    en: 'Contract not found. Please contact us.',
  },
  NOT_WHOLESALE: {
    ko: '이 계약에서는 수량 차감 발급을 쓰지 않습니다.',
    ja: 'この契約では数量差し引きの発行は行いません。',
    en: 'This contract does not use seat-month deduction.',
  },
  BAD_REQUEST: {
    ko: '인원과 개월 수를 확인해 주세요.',
    ja: '人数と月数をご確認ください。',
    en: 'Please check the number of users and months.',
  },
} as const satisfies Record<string, Msg>;

export type IssueBlockCode = keyof typeof ISSUE_BLOCK_MSG;

export function isIssueBlockCode(v: unknown): v is IssueBlockCode {
  return typeof v === 'string' && v in ISSUE_BLOCK_MSG;
}

/**
 * 서버 응답에서 파트너에게 보여 줄 글을 고른다.
 *
 * 아는 코드면 **여기 문구**(세 언어)를 쓰고, 모르는 코드면 서버가 준 글을 그대로 쓴다
 * (서버가 새 코드를 더해도 화면이 빈 말을 하지 않게).
 */
export function issueBlockMessage(
  code: unknown, serverMessage: unknown, t: (m: Msg) => string,
): string {
  if (isIssueBlockCode(code)) return t(ISSUE_BLOCK_MSG[code]);
  return typeof serverMessage === 'string' && serverMessage.trim() !== ''
    ? serverMessage
    : t({ ko: '발급하지 못했습니다.', ja: '発行できませんでした。', en: 'We could not issue the license.' });
}

// ── 계정 구역 (LEAD-S7-5) ──
//
// 파트너 **관리자에게만** 보이는 구역이다. 문구를 여기 모아 번역 빠짐을 한 곳에서 잡는다.
export const ACCOUNT_MSG = {
  sectionTitle: { ko: '계정', ja: 'アカウント', en: 'Accounts' },
  invite:       { ko: '직원 초대', ja: 'スタッフを招待', en: 'Invite a teammate' },
  inviteHint: {
    ko: '초대하면 그 주소로 로그인 계정이 만들어집니다. 비밀번호는 본인이 재설정으로 정합니다.',
    ja: '招待するとそのアドレスでログインアカウントが作成されます。パスワードは本人がリセットで設定します。',
    en: 'We create a sign-in account for that address. They set their own password with a reset link.',
  },
  email:  { ko: '이메일', ja: 'メール', en: 'Email' },
  name:   { ko: '이름 (선택)', ja: '名前（任意）', en: 'Name (optional)' },
  role:   { ko: '역할', ja: '役割', en: 'Role' },
  status: { ko: '상태', ja: '状態', en: 'Status' },
  send:   { ko: '초대 보내기', ja: '招待を送る', en: 'Send invite' },

  roleAdmin:  { ko: '관리자', ja: '管理者', en: 'Administrator' },
  roleMember: { ko: '운영자', ja: '運営者', en: 'Member' },
  roleViewer: { ko: '게스트', ja: 'ゲスト', en: 'Guest' },
  roleHint: {
    ko: '관리자 역할은 저희가 지정합니다. 여기서는 운영자·게스트만 줄 수 있습니다.',
    ja: '管理者の役割は当社が指定します。ここでは運営者・ゲストのみ付与できます。',
    en: 'We assign the Administrator role. Here you can grant Member or Guest only.',
  },

  statusInvited:  { ko: '초대함', ja: '招待済み', en: 'Invited' },
  statusActive:   { ko: '사용 중', ja: '利用中', en: 'Active' },
  statusInactive: { ko: '비활성', ja: '無効', en: 'Deactivated' },

  deactivate: { ko: '비활성화', ja: '無効化', en: 'Deactivate' },
  reactivate: { ko: '다시 사용', ja: '再有効化', en: 'Reactivate' },
  changeRole: { ko: '역할 바꾸기', ja: '役割を変更', en: 'Change role' },

  cannotSelf: {
    ko: '자기 계정은 비활성화할 수 없습니다.',
    ja: '自分のアカウントは無効化できません。',
    en: 'You cannot deactivate your own account.',
  },
  cannotLastAdmin: {
    ko: '마지막 관리자 계정이라 비활성화할 수 없습니다.',
    ja: '最後の管理者アカウントのため無効化できません。',
    en: 'This is the last administrator account, so it cannot be deactivated.',
  },
  keepsHistory: {
    ko: '비활성화해도 발급·요청 기록은 그대로 남습니다.',
    ja: '無効化しても発行・依頼の記録は残ります。',
    en: 'Deactivating an account keeps its issuance and request history.',
  },

  auditTitle: { ko: '최근 계정 기록', ja: '最近のアカウント記録', en: 'Recent account activity' },
  auditEmpty: { ko: '기록이 없습니다.', ja: '記録はありません。', en: 'No activity yet.' },
  actInvite:      { ko: '초대', ja: '招待', en: 'Invited' },
  actInviteFail:  { ko: '초대 실패', ja: '招待失敗', en: 'Invite failed' },
  actDeactivate:  { ko: '비활성화', ja: '無効化', en: 'Deactivated' },
  actReactivate:  { ko: '다시 사용', ja: '再有効化', en: 'Reactivated' },
  actRoleChange:  { ko: '역할 변경', ja: '役割変更', en: 'Role changed' },
} as const satisfies Record<string, Msg>;

export const ROLE_MSG = {
  partner_admin:  ACCOUNT_MSG.roleAdmin,
  partner_member: ACCOUNT_MSG.roleMember,
  partner_viewer: ACCOUNT_MSG.roleViewer,
} as const;

export const STATUS_MSG = {
  invited:  ACCOUNT_MSG.statusInvited,
  active:   ACCOUNT_MSG.statusActive,
  inactive: ACCOUNT_MSG.statusInactive,
  invite_failed: ACCOUNT_MSG.statusInactive,
} as const;

export const AUDIT_ACTION_MSG = {
  invite:        ACCOUNT_MSG.actInvite,
  invite_failed: ACCOUNT_MSG.actInviteFail,
  deactivate:    ACCOUNT_MSG.actDeactivate,
  reactivate:    ACCOUNT_MSG.actReactivate,
  role_change:   ACCOUNT_MSG.actRoleChange,
} as const;

// ───────────────────────── 내 리드 (LEAD-S7-7b) ─────────────────────────

export const LEAD_MSG = {
  title:        { ko: '내 리드',            ja: 'マイリード',          en: 'My leads' },
  intro:        { ko: '직접 찾은 기관을 등록해 두면 보호 기간 동안 그 건은 귀하의 것입니다.',
                  ja: '自分で見つけた機関を登録すると、保護期間中はその案件はあなたのものです。',
                  en: 'Register an organization you found and it is yours for the protection period.' },
  add:          { ko: '리드 등록',          ja: 'リード登録',          en: 'Register a lead' },
  cancel:       { ko: '취소',               ja: 'キャンセル',          en: 'Cancel' },
  submit:       { ko: '등록',               ja: '登録',                en: 'Register' },
  empty:        { ko: '아직 등록한 리드가 없습니다.',
                  ja: 'まだ登録したリードがありません。',
                  en: 'You have not registered any leads yet.' },
  loading:      { ko: '불러오는 중…',       ja: '読み込み中…',         en: 'Loading…' },

  schoolName:   { ko: '기관 이름',          ja: '機関名',              en: 'Organization' },
  schoolKind:   { ko: '종류',               ja: '種別',                en: 'Type' },
  person:       { ko: '담당자',             ja: '担当者',              en: 'Contact person' },
  position:     { ko: '직책',               ja: '役職',                en: 'Position' },
  email:        { ko: '이메일',             ja: 'メール',              en: 'Email' },
  phone:        { ko: '전화',               ja: '電話',                en: 'Phone' },
  country:      { ko: '국가',               ja: '国',                  en: 'Country' },

  ownerAsk:     { ko: '이 연락처는 누구의 것입니까?',
                  ja: 'この連絡先は誰のものですか？',
                  en: 'Whose contact details are these?' },
  ownerEndUser: { ko: '기관의 담당자 (최종 사용자)',
                  ja: '機関の担当者（エンドユーザー）',
                  en: "The organization's contact (end user)" },
  ownerPartner: { ko: '우리 회사가 대신 받습니다 (파트너 대행)',
                  ja: '当社が代理で受け取ります（パートナー代理）',
                  en: 'We receive it on their behalf (partner)' },
  consent:      { ko: '이 분의 정보를 제공하고 Tebahsoft 가 연락해도 된다는 동의를 받았습니다.',
                  ja: 'この方の情報を提供し、Tebahsoft が連絡することへの同意を得ています。',
                  en: 'I have their consent to share these details and for Tebahsoft to contact them.' },
  consentWhy:   { ko: '동의를 받은 분만 등록해 주세요. 누가 언제 확인했는지 기록됩니다.',
                  ja: '同意を得た方のみ登録してください。誰がいつ確認したかを記録します。',
                  en: 'Please register only people who consented. We record who confirmed it and when.' },
  agentNote:    { ko: '파트너 대행으로 등록하면 저희가 그 주소로 고객용 안내 메일을 보내지 않습니다.',
                  ja: 'パートナー代理で登録した場合、その宛先に顧客向け案内メールは送りません。',
                  en: 'For partner-held contacts we will not send customer mailings to that address.' },

  protection:   { ko: '보호 기간',          ja: '保護期間',            en: 'Protection' },
  daysLeft:     { ko: '일 남음',            ja: '日残り',              en: 'days left' },
  protEnded:    { ko: '보호 기간이 끝났습니다',
                  ja: '保護期間が終了しました',
                  en: 'Protection has ended' },
  protSoon:     { ko: '곧 끝납니다',        ja: 'まもなく終了します',  en: 'Ending soon' },
  protHow:      { ko: '등록일부터 90일간 보호되고, 접촉 기록을 남기면 그날부터 다시 90일입니다.',
                  ja: '登録日から90日間保護され、接触を記録するとその日から再び90日です。',
                  en: 'Protected for 90 days from registration; recording a contact restarts the 90 days.' },
  lastContact:  { ko: '마지막 접촉',        ja: '最終接触',            en: 'Last contact' },
  noContact:    { ko: '아직 접촉 기록 없음', ja: '接触記録なし',        en: 'No contact recorded' },
  contactAsk:   { ko: '접촉하셨다면 알려 주세요 — 저희가 기록하면 보호 기간이 연장됩니다.',
                  ja: '接触された場合はお知らせください。記録すると保護期間が延長されます。',
                  en: 'Tell us when you make contact — we record it and the protection period restarts.' },

  viewerOnly:   { ko: '보기 전용 계정에서는 기관 이름까지만 보입니다.',
                  ja: '閲覧専用アカウントでは機関名までの表示となります。',
                  en: 'View-only accounts see the organization name only.' },
  viewerNoAdd:  { ko: '보기 전용 계정은 리드를 등록할 수 없습니다.',
                  ja: '閲覧専用アカウントはリードを登録できません。',
                  en: 'View-only accounts cannot register leads.' },

  sumTotal:     { ko: '전체',               ja: '全体',                en: 'Total' },
  sumProtected: { ko: '보호 중',            ja: '保護中',              en: 'Protected' },
  sumEnding:    { ko: '곧 끝남',            ja: 'まもなく終了',        en: 'Ending soon' },
  sumNoContact: { ko: '접촉 없음',          ja: '接触なし',            en: 'No contact' },
} as const;

export const CONTACT_OWNER_MSG = {
  end_user: { ko: '기관 담당자', ja: '機関の担当者', en: 'Organization' },
  partner:  { ko: '파트너 대행', ja: 'パートナー代理', en: 'Partner-held' },
} as const;
