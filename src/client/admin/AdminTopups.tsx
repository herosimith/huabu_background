import { AlertCircle, Clock3, Coins, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { requestJson } from "../api";
import { AdminPageHeader, AdminState, formatAdminTime, KpiStrip, Pager } from "./AdminPrimitives";

interface TopupResponse {
  intents: Array<{ id: string; requestedCredits: number; status: "pending" | "closed"; note?: string; createdAt: string; user?: { id: string; nickname: string; email: string } }>;
  pagination: { page: number; pageSize: number; total: number; pages: number };
  summary: { total: number; pending: number; requestedCredits: number };
}

export function AdminTopups() {
  const [data, setData] = useState<TopupResponse | null>(null);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => { const timer = window.setTimeout(() => { setDebounced(search); setPage(1); }, 250); return () => window.clearTimeout(timer); }, [search]);
  const load = useCallback(async () => {
    setLoading(true); setError(""); const query = new URLSearchParams({ page: String(page), pageSize: "20" });
    if (debounced) query.set("search", debounced); if (status) query.set("status", status);
    try { setData(await requestJson<TopupResponse>(`/api/admin/topup-intents?${query}`)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "充值意向加载失败"); }
    finally { setLoading(false); }
  }, [debounced, page, status]);
  useEffect(() => { void load(); }, [load]);
  const summary = data?.summary || { total: 0, pending: 0, requestedCredits: 0 };

  return (
    <section>
      <AdminPageHeader eyebrow="支付预留" title="充值意向" description="记录用户充值需求，当前不执行支付或积分入账。" />
      <div className="admin-callout"><AlertCircle size={18} /><div><strong>充值通道即将开放</strong><span>意向只用于需求统计，不会创建积分流水，也不会改变用户余额。</span></div></div>
      <KpiStrip items={[
        { label: "全部意向", value: summary.total, detail: "当前筛选范围", icon: Coins },
        { label: "待处理", value: summary.pending, detail: "支付尚未接入", icon: Clock3, tone: "amber" },
        { label: "意向积分", value: summary.requestedCredits, detail: "不代表已到账", icon: Coins, tone: "amber" }
      ]} />
      <section className="admin-surface admin-table-surface">
        <div className="admin-filterbar topup-filters"><label><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索用户、邮箱、备注或意向号" /></label><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">全部状态</option><option value="pending">待处理</option><option value="closed">已关闭</option></select></div>
        {loading || error ? <AdminState loading={loading} error={error} onRetry={load} /> : !data?.intents.length ? <AdminState empty="暂无充值意向" /> : <div className="admin-table-wrap"><table className="admin-data-table"><thead><tr><th>提交时间</th><th>成员</th><th>意向积分</th><th>状态</th><th>备注</th><th>意向编号</th></tr></thead><tbody>{data.intents.map((item) => <tr key={item.id}><td data-label="时间">{formatAdminTime(item.createdAt)}</td><td data-label="成员"><strong>{item.user?.nickname || "未知用户"}</strong><small>{item.user?.email}</small></td><td data-label="意向积分"><b className="credit-amber">{item.requestedCredits}</b></td><td data-label="状态"><span className={`topup-status ${item.status}`}>{item.status === "pending" ? "待处理" : "已关闭"}</span></td><td data-label="备注">{item.note || "-"}</td><td data-label="编号"><code>{item.id.slice(-10)}</code></td></tr>)}</tbody></table></div>}
        {data ? <Pager {...data.pagination} onPage={setPage} /> : null}
      </section>
    </section>
  );
}
