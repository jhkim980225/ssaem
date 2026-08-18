// SQL 파일을 DB에 직접 실행한다 (테이블 생성 등 DDL용).
//
//   npx tsx scripts/run-sql.ts supabase/실행할-SQL-2.sql
//   npx tsx scripts/run-sql.ts --check              # 연결만 확인
//
// 왜 필요한가: SUPABASE_SERVICE_ROLE_KEY는 PostgREST(REST API)용이라 DDL을 못 한다.
// 테이블 생성은 Postgres에 직접 붙어야 하므로 DATABASE_URL(연결 문자열)이 따로 필요하다.
//
// .env.local에 추가:
//   DATABASE_URL=postgresql://postgres.<ref>:<비밀번호>@<host>.pooler.supabase.com:5432/postgres
//   (Supabase → Project Settings → Database → Connection string → URI, **포트 5432** Session mode)
//
// ⚠️ 이 값은 DB 전체 권한이다. .env.local은 .gitignore에 있어 커밋되지 않는다.
import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { Client } from "pg";

config({ path: ".env.local" });

const URL_ = process.env.DATABASE_URL;
const file = process.argv[2];

async function main() {
  if (!URL_) {
    console.error(
      "DATABASE_URL이 없어요.\n" +
        "Supabase → Project Settings → Database → Connection string(URI, 포트 5432)를\n" +
        ".env.local에 DATABASE_URL=... 로 넣어 주세요."
    );
    process.exit(1);
  }

  // Supabase는 TLS를 쓰지만 체인이 자체 CA라 rejectUnauthorized를 끈다 (연결 자체는 암호화됨)
  const client = new Client({ connectionString: URL_, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    const who = await client.query("select current_database() db, current_user usr, version()");
    console.log(`연결됨 — db=${who.rows[0].db} user=${who.rows[0].usr}`);

    if (!file || file === "--check") {
      const t = await client.query(
        "select table_name from information_schema.tables where table_schema='public' order by table_name"
      );
      console.log(`public 테이블 ${t.rowCount}개: ${t.rows.map((r) => r.table_name).join(", ")}`);
      return;
    }

    const sql = readFileSync(file, "utf8");
    console.log(`실행: ${file} (${sql.length}자)`);
    // 파일 전체를 한 트랜잭션으로 — 중간에 실패하면 통째로 되돌린다
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("commit");
      console.log("완료 (커밋됨)");
    } catch (e) {
      await client.query("rollback");
      throw e;
    }

    const t = await client.query(
      "select table_name from information_schema.tables where table_schema='public' order by table_name"
    );
    console.log(`public 테이블 ${t.rowCount}개: ${t.rows.map((r) => r.table_name).join(", ")}`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("실패:", e instanceof Error ? e.message : e);
  process.exit(1);
});
