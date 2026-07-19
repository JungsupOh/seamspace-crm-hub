-- partners 조회 정책 보강 (로그인 사용자)
-- 문제: partners에는 anon 전용 정책(anon_all_partners)만 있어서, 로그인(authenticated)
--       상태로 조회하면 0건이 반환됐다. AuthContext는 세션 클라이언트로 파트너 옵션을
--       읽으므로 locale/currency/can_issue_licenses가 항상 기본값(ko/KRW/false)이 되어,
--       해외 파트너에게 한국어 화면이 뜨고 이용권 발급 UI도 나타나지 않았다.
-- 조치: 본인 파트너 또는 관리자만 SELECT 가능하도록 추가.
--       (계좌번호 등 민감정보가 있어 authenticated 전체 공개는 하지 않음)

CREATE POLICY "authenticated_read_own_partner" ON partners
  FOR SELECT TO authenticated
  USING (
    id = (SELECT partner_id FROM user_profiles WHERE id = auth.uid())
    OR (SELECT role FROM user_profiles WHERE id = auth.uid()) IN ('admin', 'sub_admin')
  );
