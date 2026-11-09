// Netlify Function: 응원(cheer) 저장/집계
// 브라우저 → 이 함수 → Supabase 순서로 동작합니다.
// 가이드 요건 반영:
//  - 응원을 한 건씩 저장(insert)하고, 항목별 COUNT로 집계
//  - 허용된 item_id만 저장(없는 항목이면 거절)
//  - 저장 실패 시 성공 응답을 주지 않음
//
// 환경변수(Netlify): SUPABASE_URL, SUPABASE_SERVICE_KEY (방명록과 동일하게 사용)

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TABLE = "cheers";

// 허용된 응원 대상 목록(서버 측 화이트리스트). index.html의 data-item 값과 일치해야 함.
const ALLOWED_ITEMS = [
  "project-data-collect",
  "project-db-build",
  "project-record-writing",
  "project-portfolio",
  "work-galaga"
];

const JSON_HEADERS = { "Content-Type": "application/json" };

function sbHeaders() {
  return {
    "apikey": SUPABASE_SERVICE_KEY,
    "Authorization": "Bearer " + SUPABASE_SERVICE_KEY,
    "Content-Type": "application/json"
  };
}

// 항목별 누적 응원 수를 { item_id: count } 형태로 반환
async function getCounts() {
  const res = await fetch(
    SUPABASE_URL + "/rest/v1/" + TABLE + "?select=item_id",
    { headers: sbHeaders() }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error("집계 조회 실패: " + text);
  }
  const rows = await res.json();
  const counts = {};
  for (const id of ALLOWED_ITEMS) counts[id] = 0;
  for (const r of rows) {
    if (counts[r.item_id] === undefined) counts[r.item_id] = 0;
    counts[r.item_id]++;
  }
  return counts;
}

exports.handler = async (event) => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return {
      statusCode: 500,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: "서버 환경변수(SUPABASE_URL / SUPABASE_SERVICE_KEY)가 설정되지 않았습니다." })
    };
  }

  try {
    // ===== 집계 조회 (GET) =====
    if (event.httpMethod === "GET") {
      const counts = await getCounts();
      return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ counts }) };
    }

    // ===== 응원 저장 (POST) =====
    if (event.httpMethod === "POST") {
      let payload;
      try {
        payload = JSON.parse(event.body || "{}");
      } catch (e) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "잘못된 요청 형식입니다." }) };
      }

      const itemId = typeof payload.item_id === "string" ? payload.item_id.trim() : "";

      // 가이드 요건: 허용된 항목만 저장, 없는 항목은 거절
      if (!ALLOWED_ITEMS.includes(itemId)) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "허용되지 않은 항목입니다." }) };
      }

      const res = await fetch(SUPABASE_URL + "/rest/v1/" + TABLE, {
        method: "POST",
        headers: Object.assign(sbHeaders(), { "Prefer": "return=representation" }),
        body: JSON.stringify({ item_id: itemId })
      });

      if (!res.ok) {
        const text = await res.text();
        // 저장 실패 시 성공 응답을 주지 않음
        return { statusCode: 502, headers: JSON_HEADERS, body: JSON.stringify({ error: "저장 실패", detail: text }) };
      }

      // 저장 성공 후 최신 집계를 함께 반환해 화면이 바로 갱신되게 함
      const counts = await getCounts();
      return { statusCode: 201, headers: JSON_HEADERS, body: JSON.stringify({ ok: true, item_id: itemId, counts }) };
    }

    return { statusCode: 405, headers: JSON_HEADERS, body: JSON.stringify({ error: "허용되지 않은 메서드입니다." }) };
  } catch (err) {
    return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "서버 오류", detail: String(err) }) };
  }
};
