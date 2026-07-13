import { ArrowDown, ArrowUp, Hash, Search, Sigma } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { requestJson } from "../api";
import { AdminPageHeader, AdminState, formatAdminTime, KpiStrip, Pager } from "./AdminPrimitives";

interface LedgerResponse {
  transactions: Array<{ id: string; type: string; amount: number; balanceAfter: number; reason: string; relatedJobId?: string; createdAt: string; user?: { id: string; nickname: string; email: string } }>;
  pagination: { page: number; pageSize: number; total: number; pages: number };
  summary: { creditsIn: number; creditsOut: number; net: number; count: number };
}

const typeLabels: Record<string, string> = { initial: "初始额度", admin_adjust: "人工调整", generation: "生图消耗", refund: "失败退回" };

export function AdminLedger() {
  const [data, setData] = useState<LedgerResponse | null>(null);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [type, setType] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => { const timer = window.setTimeout(() => { setDebounced(search); setPage(1); }, 250); return () => window.clearTimeout(timer); }, [search]);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    const query = new URLSearchParams({ page: String(page), pageSize: "20" });
    if (debounced) query.set("search", debounced); if (type) query.set("type", type); if (dateFrom) query.set("dateFrom", dateFrom); if (dateTo) query.set("dateTo", dateTo);
    try { setData(await requestJson<LedgerResponse>(`/api/admin/credit-transactions?${query}`)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "流水加载失败"); }
    finally { setLoading(false); }
  }, [dateFrom, dateTo, debounced, page, type]);
  useEffect(() => { void load(); }, [load]);

  const summary = data?.summary || { creditsIn: 0, creditsOut: 0, net: 0, count: 0 };
  return (
    <section>
      <AdminPageHeader eyebrow="账务审计" title="全局积分流水" description="所有余额变化均可追溯到用户、原因和关联任务。" />
      <KpiStrip items={[
        { label: "积分流入", value: summary.creditsIn, detail: "赠送与退回", icon: ArrowDown, tone: "green" },
        { label: "积分支出", value: summary.creditsOut, detail: "生成与扣减", icon: ArrowUp, tone: "red" },
        { label: "净变动", value: summary.net, detail: "当前筛选范围", icon: Sigma, tone: summary.net >= 0 ? "green" : "red" },
        { label: "流水笔数", value: summary.count, detail: "符合筛选条件", icon: Hash }
      ]} />
      <section className="admin-surface admin-table-surface">
        <div className="admin-filterbar ledger-filters">
          <label><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索用户、邮箱、原因或流水号" /></label>
          <select value={type} onChange={(event) => { setType(event.target.value); setPage(1); }}><option value="">全部类型</option><option value="initial">初始额度</option><option value="admin_adjust">人工调整</option><option value="generation">生图消耗</option><option value="refund">失败退回</option></select>
          <input aria-label="开始日期" type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); setPage(1); }} />
          <input aria-label="结束日期" type="date" value={dateTo} onChange={(event) => { setDateTo(event.target.value); setPage(1); }} />
        </div>
        {loading || error ? <AdminState loading={loading} error={error} onRetry={load} /> : !data?.transactions.length ? <AdminState empty="没有匹配的积分流水" /> : (
          <div className="admin-table-wrap"><table className="admin-data-table"><thead><tr><th>时间</th><th>成员</th><th>类型</th><th>原因</th><th>变动</th><th>变动后余额</th><th>关联</th></tr></thead><tbody>{data.transactions.map((item) => <tr key={item.id}><td data-label="时间">{formatAdminTime(item.createdAt)}</td><td data-label="成员"><strong>{item.user?.nickname || "未知用户"}</strong><small>{item.user?.email || item.user?.id}</small></td><td data-label="类型"><span className={`ledger-type ${item.type}`}>{typeLabels[item.type] || item.type}</span></td><td data-label="原因">{item.reason}</td><td data-label="变动"><b className={item.amount >= 0 ? "credit-positive" : "credit-negative"}>{item.amount >= 0 ? "+" : ""}{item.amount}</b></td><td data-label="余额">{item.balanceAfter}</td><td data-label="关联"><code>{item.relatedJobId?.slice(-8) || "-"}</code></td></tr>)}</tbody></table></div>
        )}
        {data ? <Pager {...data.pagination} onPage={setPage} /> : null}
      </section>
    </section>
  );
}
