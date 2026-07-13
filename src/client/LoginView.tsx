import { Loader2, LockKeyhole, Sparkles } from "lucide-react";
import { FormEvent, useState } from "react";
import { requestJson } from "./api";

export interface AuthUser {
  id: string;
  nickname: string;
  email: string;
  phone?: string;
  role: "admin" | "designer" | "reviewer";
  status: "active" | "disabled";
  creditBalance: number;
  generationCount: number;
  lastActiveAt?: string;
  createdAt: string;
  updatedAt: string;
}

export function LoginView({ onLogin }: { onLogin: (user: AuthUser) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await requestJson<{ user: AuthUser }>("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      onLogin(response.user);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "登录失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-brand">
        <div className="login-mark"><Sparkles size={30} /></div>
        <p>AdCraft AI</p>
        <h1>广告生产工作台</h1>
        <span>从客户需求到可交付视觉稿，账号、额度与生成任务统一管理。</span>
      </section>
      <form className="login-panel" onSubmit={submit}>
        <div className="login-heading">
          <LockKeyhole size={22} />
          <div><h2>登录工作台</h2><p>使用管理员分配的账号继续</p></div>
        </div>
        <label><span>邮箱</span><input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" required /></label>
        <label><span>密码</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 10 个字符" required /></label>
        {error ? <div className="login-error" role="alert">{error}</div> : null}
        <button className="primary login-submit" disabled={busy || !email || !password}>
          {busy ? <Loader2 className="spin" size={17} /> : <LockKeyhole size={17} />}
          {busy ? "正在验证" : "进入工作台"}
        </button>
      </form>
    </main>
  );
}
