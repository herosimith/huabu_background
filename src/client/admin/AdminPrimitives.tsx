import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function AdminPageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return (
    <header className="admin-page-header">
      <div><span>{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>
      {action}
    </header>
  );
}

export function KpiStrip({ items }: { items: Array<{ label: string; value: string | number; detail: string; icon: LucideIcon; tone?: "blue" | "green" | "amber" | "red" }> }) {
  return (
    <section className="admin-kpi-strip" aria-label="数据概览">
      {items.map((item) => (
        <div className={`admin-kpi ${item.tone || "blue"}`} key={item.label}>
          <item.icon size={17} />
          <span><small>{item.label}</small><strong>{typeof item.value === "number" ? item.value.toLocaleString() : item.value}</strong><em>{item.detail}</em></span>
        </div>
      ))}
    </section>
  );
}

export function Pager({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (page: number) => void }) {
  return (
    <footer className="admin-pager">
      <span>共 {total.toLocaleString()} 条</span>
      <div><button disabled={page <= 1} onClick={() => onPage(page - 1)}>上一页</button><strong>{page} / {pages}</strong><button disabled={page >= pages} onClick={() => onPage(page + 1)}>下一页</button></div>
    </footer>
  );
}

export function AdminState({ loading, error, empty, onRetry }: { loading?: boolean; error?: string; empty?: string; onRetry?: () => void }) {
  if (loading) return <div className="admin-state"><span className="admin-state-loader" /><strong>正在加载数据</strong></div>;
  if (error) return <div className="admin-state error"><strong>{error}</strong>{onRetry ? <button onClick={onRetry}>重新加载</button> : null}</div>;
  if (empty) return <div className="admin-state"><strong>{empty}</strong><span>调整筛选条件后重试</span></div>;
  return null;
}

export function formatAdminTime(value?: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
