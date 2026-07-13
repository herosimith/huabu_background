import { ChevronLeft, ChevronRight, CircleDollarSign, Edit3, Loader2, Plus, Search, UserCheck, UserRound, UserX, WalletCards, X } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { requestJson } from "./api";
import type { AuthUser } from "./LoginView";
import { AdminPageHeader, KpiStrip } from "./admin/AdminPrimitives";

interface CreditTransaction {
  id: string;
  type: "initial" | "admin_adjust" | "generation" | "refund";
  amount: number;
  balanceAfter: number;
  reason: string;
  createdAt: string;
}

interface UserListResponse {
  users: AuthUser[];
  pagination: { page: number; pageSize: number; total: number; pages: number };
  stats: { total: number; active: number; disabled: number; totalCredits: number };
}

type DialogState =
  | { kind: "create" }
  | { kind: "edit"; user: AuthUser }
  | { kind: "credits"; user: AuthUser }
  | { kind: "detail"; user: AuthUser }
  | null;

const roleLabels = { admin: "管理员", designer: "设计师", reviewer: "审稿员" } as const;

function formatTime(value?: string) {
  if (!value) return "从未登录";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function UserAvatar({ user }: { user: AuthUser }) {
  return <span className="user-avatar">{user.nickname.slice(0, 1).toUpperCase()}</span>;
}

export function AdminUsers({ currentUserId }: { currentUserId: string }) {
  const [data, setData] = useState<UserListResponse | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState("");
  const [role, setRole] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<DialogState>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ page: String(page), pageSize: "10" });
      if (debouncedSearch) query.set("search", debouncedSearch);
      if (status) query.set("status", status);
      if (role) query.set("role", role);
      setData(await requestJson<UserListResponse>(`/api/admin/users?${query}`));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "用户数据加载失败");
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, page, role, status]);

  useEffect(() => { void load(); }, [load]);

  const stats = data?.stats || { total: 0, active: 0, disabled: 0, totalCredits: 0 };
  const statItems = [
    { label: "全部账号", value: stats.total, detail: "工作台成员", icon: UserRound },
    { label: "正常使用", value: stats.active, detail: "可登录与生成", icon: UserCheck },
    { label: "已停用", value: stats.disabled, detail: "禁止继续访问", icon: UserX },
    { label: "可用积分", value: stats.totalCredits, detail: "全体余额合计", icon: WalletCards }
  ];

  return (
    <section className="users-page">
      <AdminPageHeader eyebrow="成员与权限" title="用户管理" description="管理画布成员、角色、生成额度与账号状态。" action={<button className="primary" onClick={() => setDialog({ kind: "create" })}><Plus size={17} /> 新增用户</button>} />
      <KpiStrip items={statItems} />

      <section className="users-table-section">
        <div className="user-toolbar">
          <label className="user-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索昵称、邮箱、手机或用户 ID" /></label>
          <select aria-label="账号状态" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">全部状态</option><option value="active">正常</option><option value="disabled">已停用</option></select>
          <select aria-label="用户角色" value={role} onChange={(event) => { setRole(event.target.value); setPage(1); }}><option value="">全部角色</option><option value="admin">管理员</option><option value="designer">设计师</option><option value="reviewer">审稿员</option></select>
        </div>

        {error ? <div className="users-error">{error}<button onClick={() => void load()}>重试</button></div> : null}
        <div className="user-table-wrap">
          <table className="user-table">
            <thead><tr><th>成员</th><th>角色</th><th>状态</th><th>积分余额</th><th>生成次数</th><th>最近活跃</th><th><span className="sr-only">操作</span></th></tr></thead>
            <tbody>
              {loading ? Array.from({ length: 5 }).map((_, index) => <tr className="skeleton-row" key={index}><td colSpan={7}><span /></td></tr>) : null}
              {!loading && data?.users.map((user) => (
                <tr key={user.id}>
                  <td><button className="user-identity" onClick={() => setDialog({ kind: "detail", user })}><UserAvatar user={user} /><span><strong>{user.nickname}{user.id === currentUserId ? <small>当前账号</small> : null}</strong><em>{user.email}{user.phone ? ` · ${user.phone}` : ""}</em></span></button></td>
                  <td><span className={`role-chip ${user.role}`}>{roleLabels[user.role]}</span></td>
                  <td><span className={`status-chip ${user.status}`}><i />{user.status === "active" ? "正常" : "已停用"}</span></td>
                  <td><strong className="credit-value">{user.creditBalance.toLocaleString()}</strong></td>
                  <td>{user.generationCount.toLocaleString()}</td>
                  <td className="muted-cell">{formatTime(user.lastActiveAt)}</td>
                  <td><div className="row-actions"><button title="调整积分" onClick={() => setDialog({ kind: "credits", user })}><CircleDollarSign size={16} /></button><button title="编辑用户" onClick={() => setDialog({ kind: "edit", user })}><Edit3 size={16} /></button></div></td>
                </tr>
              ))}
              {!loading && !data?.users.length ? <tr><td colSpan={7}><div className="empty-users"><UserRound size={26} /><strong>没有匹配用户</strong><span>调整搜索词或筛选条件后重试</span></div></td></tr> : null}
            </tbody>
          </table>
        </div>
        <footer className="table-footer"><span>共 {data?.pagination.total || 0} 位成员</span><div><button disabled={!data || page <= 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={16} /></button><strong>{page} / {data?.pagination.pages || 1}</strong><button disabled={!data || page >= data.pagination.pages} onClick={() => setPage((value) => value + 1)}><ChevronRight size={16} /></button></div></footer>
      </section>

      {dialog ? <UserDialog state={dialog} currentUserId={currentUserId} onClose={() => setDialog(null)} onSaved={async () => { setDialog(null); await load(); }} /> : null}
    </section>
  );
}

function UserDialog({ state, currentUserId, onClose, onSaved }: { state: Exclude<DialogState, null>; currentUserId: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const user = "user" in state ? state.user : undefined;
  const [nickname, setNickname] = useState(user?.nickname || "");
  const [email, setEmail] = useState(user?.email || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AuthUser["role"]>(user?.role || "designer");
  const [status, setStatus] = useState<AuthUser["status"]>(user?.status || "active");
  const [creditBalance, setCreditBalance] = useState("20");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (state.kind !== "detail" || !user) return;
    void requestJson<{ transactions: CreditTransaction[] }>(`/api/admin/users/${user.id}`).then((response) => setTransactions(response.transactions)).catch((caught) => setError(caught instanceof Error ? caught.message : "流水加载失败"));
  }, [state.kind, user]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (state.kind === "credits" && user) {
        await requestJson(`/api/admin/users/${user.id}/credits`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ amount: Number(amount), reason }) });
      } else if (state.kind === "create") {
        await requestJson("/api/admin/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nickname, email, phone, password, role, status, creditBalance: Number(creditBalance) }) });
      } else if (state.kind === "edit" && user) {
        await requestJson(`/api/admin/users/${user.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ nickname, email, phone, password: password || undefined, role, status }) });
      }
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  const title = state.kind === "create" ? "新增工作台用户" : state.kind === "edit" ? "编辑用户" : state.kind === "credits" ? "调整生成积分" : "账号详情";
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="user-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <header><div><h2>{title}</h2><p>{user ? `${user.nickname} · ${user.email}` : "创建可登录广告画布的新成员"}</p></div><button className="dialog-close" onClick={onClose} aria-label="关闭"><X size={18} /></button></header>
        {state.kind === "detail" && user ? (
          <div className="user-detail">
            <div className="detail-profile"><UserAvatar user={user} /><div><strong>{user.nickname}</strong><span>{roleLabels[user.role]} · {user.status === "active" ? "正常" : "已停用"}</span></div><b>{user.creditBalance} 积分</b></div>
            <dl><div><dt>邮箱</dt><dd>{user.email}</dd></div><div><dt>手机</dt><dd>{user.phone || "未填写"}</dd></div><div><dt>生成次数</dt><dd>{user.generationCount}</dd></div><div><dt>注册时间</dt><dd>{formatTime(user.createdAt)}</dd></div></dl>
            <h3>最近积分流水</h3>
            <div className="credit-ledger">{transactions.map((item) => <div key={item.id}><span><strong>{item.reason}</strong><small>{formatTime(item.createdAt)}</small></span><b className={item.amount >= 0 ? "positive" : "negative"}>{item.amount >= 0 ? "+" : ""}{item.amount}<small>余额 {item.balanceAfter}</small></b></div>)}{!transactions.length ? <p>暂无积分流水</p> : null}</div>
          </div>
        ) : (
          <form onSubmit={submit}>
            {state.kind === "credits" && user ? <><div className="credit-summary"><WalletCards size={20} /><span>当前余额<strong>{user.creditBalance}</strong></span></div><label><span>调整数量</span><input type="number" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="正数增加，负数扣减" required /></label><label><span>调整原因</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="例如：活动赠送、退款补偿" minLength={2} maxLength={120} required /></label></> : <><div className="form-grid"><label><span>昵称</span><input value={nickname} onChange={(event) => setNickname(event.target.value)} minLength={2} maxLength={40} required /></label><label><span>邮箱</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label><span>手机号</span><input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="可选" /></label><label><span>{state.kind === "create" ? "初始密码" : "重置密码"}</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={state.kind === "create" ? "至少 10 个字符" : "留空则不修改"} required={state.kind === "create"} /></label><label><span>角色</span><select value={role} onChange={(event) => setRole(event.target.value as AuthUser["role"])}><option value="designer">设计师</option><option value="reviewer">审稿员</option><option value="admin">管理员</option></select></label><label><span>账号状态</span><select value={status} disabled={user?.id === currentUserId} onChange={(event) => setStatus(event.target.value as AuthUser["status"])}><option value="active">正常</option><option value="disabled">已停用</option></select></label>{state.kind === "create" ? <label><span>初始积分</span><input type="number" min="0" value={creditBalance} onChange={(event) => setCreditBalance(event.target.value)} /></label> : null}</div></>}
            {error ? <div className="dialog-error">{error}</div> : null}
            <footer><button type="button" onClick={onClose}>取消</button><button className="primary" disabled={busy}>{busy ? <Loader2 className="spin" size={16} /> : null}{busy ? "保存中" : "确认保存"}</button></footer>
          </form>
        )}
      </section>
    </div>
  );
}
