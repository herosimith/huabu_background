import { ArrowLeft, HandCoins, LayoutDashboard, LogOut, ReceiptText, Settings2, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AdminUsers } from "../AdminUsers";
import { appUrl, requestJson } from "../api";
import { AuthUser, LoginView } from "../LoginView";
import { AdminCreditRules } from "./AdminCreditRules";
import { AdminLedger } from "./AdminLedger";
import { AdminOverview } from "./AdminOverview";
import { AdminTopups } from "./AdminTopups";

const adminItems = [
  { key: "overview", label: "概览", path: "/admin/", icon: LayoutDashboard },
  { key: "users", label: "用户管理", path: "/admin/users", icon: Users },
  { key: "rules", label: "积分规则", path: "/admin/credit-rules", icon: Settings2 },
  { key: "ledger", label: "全局流水", path: "/admin/ledger", icon: ReceiptText },
  { key: "topups", label: "充值意向", path: "/admin/topups", icon: HandCoins }
] as const;

function activeAdminPage() {
  const pathname = window.location.pathname.replace(/\/+$/, "");
  if (pathname.endsWith("/admin/users")) return "users";
  if (pathname.endsWith("/admin/credit-rules")) return "rules";
  if (pathname.endsWith("/admin/ledger")) return "ledger";
  if (pathname.endsWith("/admin/topups")) return "topups";
  return "overview";
}

export function AdminApp() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const page = useMemo(activeAdminPage, []);
  useEffect(() => {
    void requestJson<{ user: AuthUser }>("/api/auth/me").then((response) => setUser(response.user)).catch(() => setUser(null)).finally(() => setLoading(false));
  }, []);

  async function logout() {
    await requestJson("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    setUser(null);
  }

  if (loading) return <div className="auth-loading"><span className="admin-state-loader" /><span>正在进入管理后台</span></div>;
  if (!user) return <LoginView onLogin={setUser} />;
  if (user.role !== "admin") {
    return <main className="admin-denied"><div className="mark">A</div><h1>没有管理权限</h1><p>当前账号只能使用广告画布，无法访问运营后台。</p><a href={appUrl("/")}><ArrowLeft size={16} />返回画布</a></main>;
  }

  const content = page === "users" ? <AdminUsers currentUserId={user.id} />
    : page === "rules" ? <AdminCreditRules />
      : page === "ledger" ? <AdminLedger />
        : page === "topups" ? <AdminTopups />
          : <AdminOverview />;

  return (
    <div className="admin-shell">
      <header className="admin-topbar">
        <a className="admin-brand" href={appUrl("/admin/")}><span className="mark">A</span><strong>AdCraft 管理后台</strong><small>运营数据</small></a>
        <div className="admin-account"><a href={appUrl("/")}><ArrowLeft size={15} />返回画布</a><span>{user.nickname}<small>管理员</small></span><button onClick={() => void logout()} title="退出登录"><LogOut size={17} /></button></div>
      </header>
      <aside className="admin-sidebar">
        <nav>{adminItems.map((item) => <a className={page === item.key ? "active" : ""} href={appUrl(item.path)} key={item.key}><item.icon size={18} /><span>{item.label}</span></a>)}</nav>
        <p>积分与生成任务共享同一账务数据源</p>
      </aside>
      <main className="admin-content">{content}</main>
      <nav className="admin-mobile-nav">{adminItems.map((item) => <a className={page === item.key ? "active" : ""} href={appUrl(item.path)} key={item.key}><item.icon size={18} /><span>{item.label}</span></a>)}</nav>
    </div>
  );
}
