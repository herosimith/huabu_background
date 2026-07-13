import { ArrowDownLeft, ArrowUpRight, Clock3, Coins, Loader2, ReceiptText, Sparkles, X } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { requestJson } from "./api";

export interface CreditSummary {
  balance: number;
  generationCount: number;
  activeRule: { version: number; costs: { standardGeneration: number; highQualitySurcharge: number; highResolutionSurcharge: number } };
  transactions: Array<{ id: string; type: string; amount: number; balanceAfter: number; reason: string; createdAt: string }>;
  topupIntents: Array<{ id: string; requestedCredits: number; status: "pending" | "closed"; createdAt: string }>;
}

const transactionLabels: Record<string, string> = { initial: "初始额度", admin_adjust: "人工调整", generation: "生图消耗", refund: "失败退回" };

function shortTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function CreditDrawer({ open, onClose, initialBalance, onBalanceChange }: { open: boolean; onClose: () => void; initialBalance: number; onBalanceChange: (balance: number) => void }) {
  const [data, setData] = useState<CreditSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [requestedCredits, setRequestedCredits] = useState(100);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await requestJson<CreditSummary>("/api/credits/summary");
      setData(response); onBalanceChange(response.balance);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "积分信息加载失败"); }
    finally { setLoading(false); }
  }, [onBalanceChange]);
  useEffect(() => { if (open) void load(); }, [load, open]);

  async function submitTopup(event: FormEvent) {
    event.preventDefault(); setSubmitting(true); setError(""); setMessage("");
    try {
      const response = await requestJson<{ message: string }>("/api/credits/topup-intents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestedCredits }) });
      setMessage(response.message); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "充值意向提交失败"); }
    finally { setSubmitting(false); }
  }

  if (!open) return null;
  const balance = data?.balance ?? initialBalance;
  return (
    <div className="credit-drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="credit-drawer" role="dialog" aria-modal="true" aria-label="个人积分中心">
        <header><div><span><Coins size={17} />个人积分中心</span><strong>{balance.toLocaleString()}<small>积分</small></strong><p>规则版本 v{data?.activeRule.version || "-"} · 共生成 {data?.generationCount || 0} 次</p></div><button onClick={onClose} aria-label="关闭积分中心"><X size={18} /></button></header>
        {loading && !data ? <div className="credit-drawer-state"><Loader2 className="spin" size={22} />正在同步余额</div> : null}
        {error ? <div className="credit-drawer-error">{error}<button onClick={() => void load()}>重试</button></div> : null}
        {data ? <>
          <section className="credit-costs"><div><Sparkles size={16} /><span>标准生图<strong>{data.activeRule.costs.standardGeneration}</strong></span></div><div><ArrowUpRight size={16} /><span>高质量附加<strong>+{data.activeRule.costs.highQualitySurcharge}</strong></span></div><div><ArrowUpRight size={16} /><span>高分辨率附加<strong>+{data.activeRule.costs.highResolutionSurcharge}</strong></span></div></section>
          <section className="personal-ledger"><header><div><ReceiptText size={16} /><strong>近期流水</strong></div><button onClick={() => void load()}>刷新</button></header><div>{data.transactions.map((item) => <div className="personal-ledger-row" key={item.id}><i className={item.amount >= 0 ? "positive" : "negative"}>{item.amount >= 0 ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}</i><span><strong>{item.reason || transactionLabels[item.type]}</strong><small>{shortTime(item.createdAt)} · 余额 {item.balanceAfter}</small></span><b className={item.amount >= 0 ? "positive" : "negative"}>{item.amount >= 0 ? "+" : ""}{item.amount}</b></div>)}{!data.transactions.length ? <p>暂无积分流水</p> : null}</div></section>
          <form className="topup-request" onSubmit={submitTopup}><header><div><Clock3 size={16} /><span><strong>申请充值</strong><small>通道即将开放，提交后不会立即到账</small></span></div></header><div className="topup-presets">{[100, 300, 1000].map((value) => <button type="button" className={requestedCredits === value ? "active" : ""} onClick={() => setRequestedCredits(value)} key={value}>{value} 积分</button>)}</div><label><span>自定义积分</span><input type="number" min="10" max="100000" value={requestedCredits} onChange={(event) => setRequestedCredits(Number(event.target.value))} /></label>{message ? <div className="topup-message">{message}</div> : null}<button className="primary" disabled={submitting}>{submitting ? <Loader2 className="spin" size={16} /> : <Coins size={16} />}{submitting ? "提交中" : "提交充值意向"}</button></form>
          {data.topupIntents.length ? <section className="topup-history"><strong>最近意向</strong>{data.topupIntents.slice(0, 3).map((intent) => <div key={intent.id}><span>{intent.requestedCredits} 积分</span><small>{intent.status === "pending" ? "待开放" : "已关闭"} · {shortTime(intent.createdAt)}</small></div>)}</section> : null}
        </> : null}
      </aside>
    </div>
  );
}
