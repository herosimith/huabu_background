import { Activity, ArrowDownToLine, CircleDollarSign, Image, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { appUrl, requestJson } from "../api";
import { AdminPageHeader, AdminState, formatAdminTime, KpiStrip } from "./AdminPrimitives";

interface OverviewData {
  totalUsers: number;
  activeUsers: number;
  todayGenerations: number;
  todayNetCredits: number;
  pendingTopups: number;
  totalCreditBalance: number;
  recentTransactions: Array<{ id: string; type: string; amount: number; reason: string; balanceAfter: number; createdAt: string }>;
}

export function AdminOverview() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    try { setData(await requestJson<OverviewData>("/api/admin/overview")); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "概览加载失败"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <section>
      <AdminPageHeader eyebrow="运营总览" title="管理概览" description="查看成员、生成消耗和待处理充值意向。" />
      <KpiStrip items={[
        { label: "活跃成员", value: data?.activeUsers || 0, detail: `全部 ${data?.totalUsers || 0} 人`, icon: Users },
        { label: "今日生成", value: data?.todayGenerations || 0, detail: "画布任务", icon: Image },
        { label: "今日净积分", value: data?.todayNetCredits || 0, detail: "入账减消耗", icon: CircleDollarSign, tone: (data?.todayNetCredits || 0) >= 0 ? "green" : "red" },
        { label: "充值意向", value: data?.pendingTopups || 0, detail: "待接入支付", icon: ArrowDownToLine, tone: "amber" }
      ]} />
      {error || !data ? <AdminState loading={!error} error={error} onRetry={load} /> : (
        <div className="admin-overview-grid">
          <section className="admin-surface recent-activity">
            <header><div><Activity size={17} /><strong>最近积分动态</strong></div><a href={appUrl("/admin/ledger")}>查看全部</a></header>
            <div>{data.recentTransactions.map((item) => <div className="activity-row" key={item.id}><i className={item.amount >= 0 ? "positive" : "negative"}>{item.amount >= 0 ? "+" : ""}{item.amount}</i><span><strong>{item.reason}</strong><small>{formatAdminTime(item.createdAt)} · 余额 {item.balanceAfter}</small></span></div>)}{!data.recentTransactions.length ? <p className="admin-empty-copy">暂无积分动态</p> : null}</div>
          </section>
          <aside className="admin-surface admin-briefing">
            <header><strong>运营状态</strong><span>实时</span></header>
            <dl><div><dt>平台积分池</dt><dd>{data.totalCreditBalance.toLocaleString()}</dd></div><div><dt>活跃率</dt><dd>{data.totalUsers ? Math.round(data.activeUsers / data.totalUsers * 100) : 0}%</dd></div><div><dt>充值通道</dt><dd className="amber">尚未接入</dd></div></dl>
            <p>充值意向只记录用户需求，不会自动增加积分。</p>
          </aside>
        </div>
      )}
    </section>
  );
}
