// 퀵가이드 첨부 목록·안내 문구·첨부 로더 — CRM-022.
//
// **이 파일은 두 곳에 바이트 단위로 같은 내용으로 존재한다.**
//   · src/lib/quickGuide.ts                                       (브라우저, Vite)
//   · supabase/functions/campaign-submit-lead/quick-guide.ts      (서버, Deno)
// import 가 하나도 없고 fetch/btoa 만 써서 두 런타임에서 그대로 돈다.
// 한쪽만 고치면 src/test/campaign-submit-lead.test.ts 의 드리프트 가드가 깨진다.
// → 고칠 때는 **두 파일을 함께** 고칠 것.
//
// 첨부 목록의 원본은 mdCRM/assets_incoming/quick_guide_new_20261115/attachments_manifest.json
// (언어별 첨부 순서·표시 이름). 쪽을 빼거나 순서를 바꾸려면 아래 QUICK_GUIDE_FILES 배열만 고친다.
// 실제 PDF 는 public/docs/quick-guide/<lang>/ 에 같은 파일명으로 있어야 한다.

export type GuideLang = 'ko' | 'ja' | 'en';

export interface GuideFile {
  /** 파일명 = 첨부 파일명 (public/docs/quick-guide/<lang>/ 아래) */
  file: string;
  /** 표시 이름 (메일 본문 목록·완료 화면 링크) */
  label: string;
}

/** public 정적 경로. 서버는 운영 사이트 주소를 앞에 붙여 쓴다. */
export const QUICK_GUIDE_DIR = '/docs/quick-guide';

export const QUICK_GUIDE_FILES: Record<GuideLang, GuideFile[]> = {
  en: [
    { file: 'Seamspace_QuickGuide_EN_01_How_To_Start.pdf', label: '01 How To Start' },
    { file: 'Seamspace_QuickGuide_EN_02_Sign_Up_and_Login.pdf', label: '02 Sign Up and Login' },
    { file: 'Seamspace_QuickGuide_EN_03_Admin_Page.pdf', label: '03 Admin Page' },
    { file: 'Seamspace_QuickGuide_EN_04_Group_Journal.pdf', label: '04 Group Journal' },
    { file: 'Seamspace_QuickGuide_EN_05_Wall.pdf', label: '05 Wall' },
    { file: 'Seamspace_QuickGuide_EN_06_Worksheet.pdf', label: '06 Worksheet' },
    { file: 'Seamspace_QuickGuide_EN_07_Newsletter.pdf', label: '07 Newsletter' },
  ],
  ja: [
    { file: 'Seamspace_QuickGuide_JA_01_How_To_Start.pdf', label: '01 How To Start' },
    { file: 'Seamspace_QuickGuide_JA_02_Sign_Up_and_Login.pdf', label: '02 Sign Up and Login' },
    { file: 'Seamspace_QuickGuide_JA_03_Admin_Page.pdf', label: '03 Admin Page' },
    { file: 'Seamspace_QuickGuide_JA_04_Shared_Story.pdf', label: '04 Shared Story' },
    { file: 'Seamspace_QuickGuide_JA_05_Wall.pdf', label: '05 Wall' },
    { file: 'Seamspace_QuickGuide_JA_06_Worksheet.pdf', label: '06 Worksheet' },
    { file: 'Seamspace_QuickGuide_JA_07_Newsletter.pdf', label: '07 Newsletter' },
  ],
  ko: [
    { file: 'Seamspace_QuickGuide_KO_01_Basic_Usage.pdf', label: '01 Basic Usage' },
    { file: 'Seamspace_QuickGuide_KO_02_Admin_Page.pdf', label: '02 Admin Page' },
    { file: 'Seamspace_QuickGuide_KO_03_Shared_Story.pdf', label: '03 Shared Story' },
    { file: 'Seamspace_QuickGuide_KO_04_Wall.pdf', label: '04 Wall' },
    { file: 'Seamspace_QuickGuide_KO_05_Worksheet.pdf', label: '05 Worksheet' },
    { file: 'Seamspace_QuickGuide_KO_06_Newsletter.pdf', label: '06 Newsletter' },
  ],
};

export const TUTORIAL_URL: Record<GuideLang, string> = {
  ko: 'https://www.seamspace.site/ko/resource/tutorial',
  ja: 'https://www.seamspace.site/ja/resource/tutorial',
  en: 'https://www.seamspace.site/resource/tutorial',
};

/** ko / ja 만 해당 언어, 그 밖(영어·튀르키예어 등)은 영어 목록. */
export function guideLang(locale?: string | null): GuideLang {
  return locale === 'ko' ? 'ko' : locale === 'ja' ? 'ja' : 'en';
}

export function guideFileUrl(lang: GuideLang, file: string, base = ''): string {
  return `${base}${QUICK_GUIDE_DIR}/${lang}/${encodeURIComponent(file)}`;
}

const HEADING = {
  ko: (n: number) => `첨부 파일 (퀵가이드 PDF ${n}개)`,
  ja: (n: number) => `添付ファイル（Quick Guide PDF ${n}点）`,
  en: (n: number) => `Attached files (Quick Guide, ${n} PDFs)`,
};
const TUTORIAL_LABEL = {
  ko: '온라인 튜토리얼',
  ja: 'オンラインチュートリアル',
  en: 'Online tutorial',
};

/** 메일 본문(HTML)에 넣는 첨부 목록 + 튜토리얼 링크. */
export function guideBlockHtml(lang: GuideLang): string {
  const files = QUICK_GUIDE_FILES[lang];
  return `<p style="margin:0 0 16px;font-size:12px;color:#64748b;line-height:1.7;">
      ${HEADING[lang](files.length)}<br/>
      ${files.map(f => f.label).join('<br/>\n      ')}
    </p>
    <p style="margin:0 0 16px;font-size:12px;color:#64748b;line-height:1.7;">
      ${TUTORIAL_LABEL[lang]}: <a href="${TUTORIAL_URL[lang]}" style="color:#6366f1;text-decoration:none;">${TUTORIAL_URL[lang]}</a>
    </p>`;
}

/** plain text 본문용 줄 목록. */
export function guideBlockText(lang: GuideLang): string[] {
  const files = QUICK_GUIDE_FILES[lang];
  return [
    `${HEADING[lang](files.length)}:`,
    ...files.map(f => `- ${f.label}`),
    `${TUTORIAL_LABEL[lang]}: ${TUTORIAL_URL[lang]}`,
  ];
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
  }
  return btoa(binary);
}

/**
 * 언어별 퀵가이드 PDF 를 모두 받아 base64 첨부로 만든다.
 *
 * 실패 정책: **전부 받거나 아예 안 붙인다**(undefined). 본문의 첨부 목록과 실제 첨부가
 * 어긋나는 것을 피하고, 기존 동작(첨부 실패여도 메일은 간다)을 유지한다.
 * Vercel 은 없는 경로를 index.html(200)로 돌려주므로 `%PDF` 헤더까지 확인한다.
 */
export async function fetchGuideAttachments(
  lang: GuideLang,
  base = '',
  tag = 'quick-guide',
): Promise<Array<{ filename: string; content: string }> | undefined> {
  try {
    const out = await Promise.all(QUICK_GUIDE_FILES[lang].map(async (f) => {
      const r = await fetch(guideFileUrl(lang, f.file, base));
      if (!r.ok) throw new Error(`${f.file} ${r.status}`);
      const bytes = new Uint8Array(await r.arrayBuffer());
      const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
      if (!isPdf) throw new Error(`${f.file} PDF 아님`);
      return { filename: f.file, content: toBase64(bytes) };
    }));
    return out;
  } catch (e) {
    console.warn(`[${tag}] Quick Guide PDF 첨부 실패 (메일은 진행)`, e);
    return undefined;
  }
}
