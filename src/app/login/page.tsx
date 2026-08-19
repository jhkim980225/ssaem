"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { toEmail, isValidId } from "@/lib/account";
import { homeFor, roleFitsTab, type Role as RealRole } from "@/lib/role";
import { useAuth, ensureRole } from "@/lib/auth-store";

type Role = "teacher" | "student";

// 오픈 리다이렉트 방지: 같은 오리진의 절대 경로만 허용한다.
// "//evil.com", "https://evil.com", "/\evil.com" 전부 막힌다.
function safeNext(v: string | null): string | null {
  if (!v) return null;
  return /^\/(?![/\\])/.test(v) ? v : null;
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="flex-1" />}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [role, setRole] = useState<Role>(params.get("role") === "teacher" ? "teacher" : "student");
  const [mode, setMode] = useState<"login" | "signup">("login");

  const [id, setId] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  // 학생 가입은 비밀번호 대신 휴대폰을 받는다 (뒷 4자리가 첫 비밀번호 → 첫 로그인에서 변경 강제)
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [invite, setInvite] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const auth = useAuth();
  const next = safeNext(params.get("next"));

  // 이미 로그인돼 있으면 "실제" 역할에 맞는 화면으로 (탭 선택값이 아니라 서버 profiles 기준).
  // 스토어가 이미 확정한 값을 쓰므로 여기서 getSession/profile을 다시 부르지 않는다.
  //
  // busy·err 가드가 필요한 이유: 탭 불일치를 처리하는 동안 스토어는 잠깐 signed-in이 된다
  // (signInWithPassword는 성공했고 signOut은 아직 안 끝난 구간). 가드가 없으면 그 순간
  // 이 이펙트가 이겨서 안내 문구가 1프레임만 보이고 대시보드로 밀려난다.
  useEffect(() => {
    if (busy || err) return;
    if (auth.status !== "signed-in" || auth.role === undefined) return;
    router.replace(next ?? homeFor(auth.role));
  }, [auth.status, auth.role, busy, err, next, router]);

  // 학생 가입만 휴대폰 방식 — 강사·원장은 기존대로 비밀번호를 직접 정한다
  const phoneSignup = mode === "signup" && role === "student";

  async function submit() {
    // 버튼 disabled만으로는 Enter 연타를 못 막는다 (onKeyDown이 직접 submit을 부른다).
    if (busy) return;
    setErr("");
    if (!id.trim()) return setErr("아이디를 입력해 주세요.");
    if (!phoneSignup && !pw) return setErr("비밀번호를 입력해 주세요.");
    if (mode === "signup") {
      // 가입은 아이디만 — 이메일 주소는 받지 않는다 (로그인은 기존 이메일 계정도 가능)
      if (id.includes("@"))
        return setErr("이메일이 아니라 아이디로 가입해 주세요. (영문·숫자 2~30자)");
      if (!isValidId(id.trim()))
        return setErr("아이디는 영문·숫자와 . _ - 를 써서 2~30자로 지어 주세요.");
      if (phoneSignup) {
        if (phone.replace(/[^0-9]/g, "").length < 4)
          return setErr("휴대폰 번호를 입력해 주세요. 뒷 4자리가 첫 비밀번호가 돼요.");
      } else {
        if (pw.length < 8) return setErr("비밀번호는 8자 이상이어야 해요.");
        if (pw !== pw2) return setErr("두 비밀번호가 서로 달라요.");
      }
    }
    setBusy(true);
    // 네트워크 throw 시 '처리 중…'으로 영구 잠기던 것 방지 — finally에서 busy 해제
    try {

    if (mode === "signup") {
      const academySlug = params.get("academy");
      const r = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role,
          email: id.trim(),
          // 학생 휴대폰 가입은 password를 보내지 않는다 — 서버가 뒷 4자리로 만든다
          ...(phoneSignup ? { phone: phone.trim() } : { password: pw }),
          name: name.trim() || id.trim(),
          // 같은 칸을 역할별로 다르게 쓴다.
          // 강사 탭은 전역 코드와 원장 초대코드를 둘 다 받는데 서버 필드가 다르다 —
          // 원장 코드("t."로 시작)를 inviteCode로 보내면 전역 코드와 비교돼 무조건 403이었다.
          ...(role === "student"
            ? { studentInviteCode: invite.trim() }
            : invite.trim().startsWith("t.")
              ? { teacherInviteCode: invite.trim() }
              : { inviteCode: invite.trim() }),
          academySlug,
        }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        setBusy(false);
        return setErr(d?.error ?? "가입하지 못했어요.");
      }
    }

    // 학생 휴대폰 가입은 서버가 뒷 4자리를 비밀번호로 만들었으므로 그 값으로 로그인한다
    const loginPw = phoneSignup ? phone.replace(/[^0-9]/g, "").slice(-4) : pw;
    const { data: signed, error } = await supabase.auth.signInWithPassword({
      email: toEmail(id),
      password: loginPw,
    });
    if (error) {
      setBusy(false);
      setErr(mode === "login" ? "아이디나 비밀번호가 맞지 않아요." : error.message);
      return;
    }

    // 역할은 항상 서버 profiles 기준. 탭 선택값은 "이 탭으로는 이 역할만"이라는 필터일 뿐,
    // 역할을 정하는 근거로는 절대 쓰지 않는다 (탭을 신뢰하면 권한 상승이 된다).
    // 스토어와 같은 요청을 공유한다. 각자 부르면 로그인 1회에 /api/profile이 2번 나간다.
    const got = await ensureRole(signed.session!);
    if (got === "unauthorized") {
      // 위와 같은 이유로 안내가 먼저다
      setBusy(false);
      setErr("로그인 정보를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.");
      await supabase.auth.signOut();
      return;
    }
    const realRole: RealRole = got;
    if (!roleFitsTab(role, realRole)) {
      // 안내를 먼저 띄우고 로그아웃은 뒤에 — signOut 네트워크를 기다리는 사이에
      // 리다이렉트 이펙트가 먼저 돌면 문구가 안 보인 채 화면이 넘어간다.
      setBusy(false);
      setErr(
        realRole === "admin"
          ? "학원장 계정이에요. 학원장 화면에서 로그인해 주세요."
          : realRole === "student"
            ? "학생 계정이에요. 학생 탭에서 로그인해 주세요."
            : realRole === "teacher"
              ? "강사 계정이에요. 강사 탭에서 로그인해 주세요."
              : "이 탭으로는 로그인할 수 없는 계정이에요."
      );
      await supabase.auth.signOut();
      return;
    }

    router.replace(next ?? homeFor(realRole));
    } catch {
      setErr("네트워크 오류로 로그인하지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex-1 w-full max-w-sm mx-auto px-5 py-14">
      {/* 역할 탭 */}
      <div className="rise flex gap-1.5 mb-7">
        {(
          [
            ["student", "학생"],
            ["teacher", "강사"],
          ] as const
        ).map(([r, label]) => (
          <button
            key={r}
            onClick={() => {
              setRole(r);
              setErr("");
            }}
            className={`chip flex-1 !py-2.5 ${role === r ? "chip-on" : ""}`}
          >
            {label}
          </button>
        ))}
      </div>

      <h1 className="rise d1 text-[24px] font-extrabold">
        {role === "teacher" ? "강사" : "학생"} {mode === "login" ? "로그인" : "회원가입"}
      </h1>
      <div className="rise d2 mt-6 flex flex-col gap-3">
        <input
          className="field"
          placeholder="아이디 (영문·숫자 2~30자)"
          autoCapitalize="none"
          autoCorrect="off"
          value={id}
          onChange={(e) => {
            setId(e.target.value);
            setErr("");
          }}
        />
        {!phoneSignup && (
          <input
            className="field"
            type="password"
            placeholder="비밀번호"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        )}
        {phoneSignup && (
          <>
            <input
              className="field"
              type="tel"
              inputMode="numeric"
              placeholder="휴대폰 번호 (숫자만, 예: 01012345678)"
              maxLength={11}
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
            <p className="text-sub text-[12px] -mt-1.5 leading-relaxed">
              첫 비밀번호는 <b>휴대폰 뒷 4자리</b>예요. 로그인하면 바로 바꾸게 안내해 드려요.
            </p>
          </>
        )}
        {mode === "signup" && (
          <>
            {!phoneSignup && (
            <input
              className="field"
              type="password"
              placeholder="비밀번호 확인"
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
            )}
            <input
              className="field"
              placeholder="이름"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className="field"
              placeholder={role === "teacher" ? "초대코드 (전역 코드 또는 원장님 초대코드)" : "선생님 초대코드 (선택)"}
              autoCapitalize="none"
              autoCorrect="off"
              value={invite}
              onChange={(e) => setInvite(e.target.value)}
            />
            {role === "student" && (
              <p className="text-sub text-[12px] -mt-1.5 leading-relaxed">
                선생님께 받은 코드를 넣으면 그 선생님 반에 바로 등록돼요. 없으면 비워두세요.
              </p>
            )}
          </>
        )}

        <button onClick={submit} disabled={busy} className="btn btn-primary py-4 mt-1">
          {busy ? "처리 중…" : mode === "login" ? "로그인" : "가입하고 시작하기"}
        </button>

        {err && (
          <p className="text-[13px] font-bold" style={{ color: "var(--red)" }}>
            {err}
          </p>
        )}

        <button
          onClick={() => {
            setMode(mode === "login" ? "signup" : "login");
            setErr("");
          }}
          className="text-sub text-[14px] mt-1"
        >
          {mode === "login" ? "계정이 없나요? 회원가입" : "이미 계정이 있나요? 로그인"}
        </button>

        {mode === "login" && (
          <Link href="/reset" className="text-sub text-[13px] text-center">
            비밀번호를 잊으셨나요?
          </Link>
        )}

      </div>
    </main>
  );
}
