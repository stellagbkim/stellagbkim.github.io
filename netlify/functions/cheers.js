// Netlify Function: 응원(cheer) 저장/집계/토글
// 브라우저 → 이 함수 → Supabase 순서로 동작합니다.
//  - GET: 항목별 누적 응원 수 집계 반환. voter 쿼리로 "내가 누른 항목"도 함께 반환
//  - POST: 1인 1표 토글. 같은 voter_id가 같은 item_id를 이미 눌렀으면 취소(삭제), 아니면 추가(insert)
//  - 허용된 item_id만 처리(없는 항목이면 거절)
//
// 환경변수(Netlify): SUPABASE_URL, SUPABASE_SERVICE_KEY
// 사전 준비(SQL): alter table cheers add column if not exists voter_id text;

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

// URL 쿼리 문자열에 쓸 수 있도록 값 인코딩
function enc(v) { return encodeURIComponent(v); }

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

// 특정 voter가 응원한 item_id 목록 반환
async function getVoterItems(voterId) {
  if (!voterId) return [];
  const res = await fetch(
    SUPABASE_URL + "/rest/v1/" + TABLE + "?select=item_id&voter_id=eq." + enc(voterId),
    { headers: sbHeaders() }
  );
  if (!res.ok) return [];
  const rows = await res.json();
  return rows.map(r => r.item_id);
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
    // ?voter=xxx 가 있으면 그 방문자가 누른 항목 목록도 함께 반환
    if (event.httpMethod === "GET") {
      const voterId = (event.queryStringParameters && event.queryStringParameters.voter) || "";
      const counts = await getCounts();
      const mine = await getVoterItems(voterId);
      return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ counts, mine }) };
    }

    // ===== 응원 토글 (POST) =====
    if (event.httpMethod === "POST") {
      let payload;
      try {
        payload = JSON.parse(event.body || "{}");
      } catch (e) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "잘못된 요청 형식입니다." }) };
      }

      const itemId = typeof payload.item_id === "string" ? payload.item_id.trim() : "";
      const voterId = typeof payload.voter_id === "string" ? payload.voter_id.trim() : "";

      // 허용된 항목만 처리, 없는 항목은 거절
      if (!ALLOWED_ITEMS.includes(itemId)) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "허용되지 않은 항목입니다." }) };
      }
      if (!voterId) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "방문자 식별값이 없습니다." }) };
      }

      // 이 voter가 이 항목을 이미 눌렀는지 확인
      const checkRes = await fetch(
        SUPABASE_URL + "/rest/v1/" + TABLE + "?select=id&item_id=eq." + enc(itemId) + "&voter_id=eq." + enc(voterId),
        { headers: sbHeaders() }
      );
      if (!checkRes.ok) {
        const text = await checkRes.text();
        return { statusCode: 502, headers: JSON_HEADERS, body: JSON.stringify({ error: "조회 실패", detail: text }) };
      }
      const existing = await checkRes.json();

      let active; // 토글 후 이 항목이 "응원함" 상태인지
      if (existing.length > 0) {
        // 이미 응원함 → 취소(삭제)
        const delRes = await fetch(
          SUPABASE_URL + "/rest/v1/" + TABLE + "?item_id=eq." + enc(itemId) + "&voter_id=eq." + enc(voterId),
          { method: "DELETE", headers: sbHeaders() }
        );
        if (!delRes.ok) {
          const text = await delRes.text();
          return { statusCode: 502, headers: JSON_HEADERS, body: JSON.stringify({ error: "취소 실패", detail: text }) };
        }
        active = false;
      } else {
        // 아직 안 함 → 추가(insert)
        const insRes = await fetch(SUPABASE_URL + "/rest/v1/" + TABLE, {
          method: "POST",
          headers: Object.assign(sbHeaders(), { "Prefer": "return=representation" }),
          body: JSON.stringify({ item_id: itemId, voter_id: voterId })
        });
        if (!insRes.ok) {
          const text = await insRes.text();
          return { statusCode: 502, headers: JSON_HEADERS, body: JSON.stringify({ error: "저장 실패", detail: text }) };
        }
        active = true;
      }

      // 토글 후 최신 집계 + 이 voter의 항목 목록 반환
      const counts = await getCounts();
      const mine = await getVoterItems(voterId);
      return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ ok: true, item_id: itemId, active, counts, mine }) };
    }

    return { statusCode: 405, headers: JSON_HEADERS, body: JSON.stringify({ error: "허용되지 않은 메서드입니다." }) };
  } catch (err) {
    return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "서버 오류", detail: String(err) }) };
  }
};
