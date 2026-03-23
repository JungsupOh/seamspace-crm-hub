// Supabase Edge Function: ocr-partner-doc
// 파트너 서류 이미지를 Claude Vision으로 OCR 처리

import Anthropic from "npm:@anthropic-ai/sdk";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const PROMPTS = {
  business_reg: `이 사업자등록증 이미지에서 정보를 추출해 JSON 형식으로만 반환하세요. 설명 텍스트 없이 JSON만 출력하세요.

{
  "company_name": "상호(법인명)",
  "business_number": "사업자등록번호 (XXX-XX-XXXXX 형식으로)",
  "representative": "대표자명",
  "address": "사업장 소재지 전체 주소",
  "business_type": "업태 및 종목 (예: 도소매업 / 전자상거래)"
}

추출 불가한 필드는 null로 설정하세요.`,

  bank_account: `이 통장사본 이미지에서 정보를 추출해 JSON 형식으로만 반환하세요. 설명 텍스트 없이 JSON만 출력하세요.

{
  "bank_name": "은행명 (예: 국민은행, 신한은행)",
  "account_number": "계좌번호 (숫자와 하이픈만)",
  "account_holder": "예금주명"
}

추출 불가한 필드는 null로 설정하세요.`,
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const { image_base64, media_type, doc_type } = await req.json() as {
      image_base64: string;
      media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
      doc_type: "business_reg" | "bank_account";
    };

    if (!image_base64 || !doc_type) {
      return new Response(JSON.stringify({ error: "image_base64, doc_type 필수" }), {
        status: 400, headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: media_type ?? "image/jpeg", data: image_base64 },
          },
          { type: "text", text: PROMPTS[doc_type] ?? "이 문서에서 주요 정보를 JSON으로 추출하세요." },
        ],
      }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "{}";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const data = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json", ...CORS },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }
});
