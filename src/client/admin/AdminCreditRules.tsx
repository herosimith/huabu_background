import { Clock3, Loader2, Save, ShieldCheck, Sparkles, Zap } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { requestJson } from "../api";
import { AdminPageHeader, AdminState, formatAdminTime } from "./AdminPrimitives";

interface CreditRule {
  id: string;
  version: number;
  active: boolean;
  signupGrant: number;
  costs: { standardGeneration: number; highQualitySurcharge: number; highResolutionSurcharge: number };
  createdBy: string;
  createdAt: string;
}

export function AdminCreditRules() {
  const [activeRule, setActiveRule] = useState<CreditRule | null>(null);
  const [versions, setVersions] = useState<CreditRule[]>([]);
  const [form, setForm] = useState({ signupGrant: 20, standardGeneration: 1, highQualitySurcharge: 1, highResolutionSurcharge: 2 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await requestJson<{ activeRule: CreditRule; versions: CreditRule[] }>("/api/admin/credit-rules");
      setActiveRule(response.activeRule); setVersions(response.versions);
      setForm({ signupGrant: response.activeRule.signupGrant, ...response.activeRule.costs });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "规则加载失败"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError(""); setMessage("");
    try {
      const response = await requestJson<{ activeRule: CreditRule; message: string }>("/api/admin/credit-rules", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
      setMessage(response.message); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "规则发布失败"); }
    finally { setSaving(false); }
  }

  return (
    <section>
      <AdminPageHeader eyebrow="账务策略" title="积分规则" description="发布新版本后，后续真实生图按服务端规则扣费。" action={activeRule ? <div className="rule-version"><ShieldCheck size={16} /><span>当前 v{activeRule.version}<small>{formatAdminTime(activeRule.createdAt)} 发布</small></span></div> : null} />
      {loading || error ? <AdminState loading={loading} error={error} onRetry={load} /> : (
        <div className="rules-layout">
          <form className="admin-surface rules-form" onSubmit={submit}>
            <header><div><Zap size={18} /><span><strong>新规则版本</strong><small>费用始终由服务端计算，前端不能传入价格。</small></span></div></header>
            <div className="rule-fields">
              {[
                ["signupGrant", "注册赠送", "新建用户未指定初始积分时使用", Sparkles],
                ["standardGeneration", "标准生图", "每次真实生图的基础消耗", Zap],
                ["highQualitySurcharge", "高质量附加", "quality=high 时叠加", Save],
                ["highResolutionSurcharge", "高分辨率附加", "超过 2560×1440 时叠加", ShieldCheck]
              ].map(([key, label, detail, Icon]) => (
                <label className="rule-field" key={String(key)}><Icon size={17} /><span><strong>{String(label)}</strong><small>{String(detail)}</small></span><input type="number" min={key === "standardGeneration" ? 1 : 0} max="10000" value={form[key as keyof typeof form]} onChange={(event) => setForm({ ...form, [key as string]: Number(event.target.value) })} /></label>
              ))}
            </div>
            {message ? <div className="rule-message success">{message}</div> : null}{error ? <div className="rule-message error">{error}</div> : null}
            <footer><span>发布会创建 v{(activeRule?.version || 0) + 1}，历史版本保留用于审计。</span><button className="primary" disabled={saving}>{saving ? <Loader2 className="spin" size={16} /> : <Save size={16} />}{saving ? "发布中" : "发布新版本"}</button></footer>
          </form>
          <aside className="admin-surface rule-history"><header><Clock3 size={17} /><strong>版本记录</strong></header><div>{versions.map((rule) => <div key={rule.id}><i className={rule.active ? "active" : ""} /><span><strong>v{rule.version}{rule.active ? " · 当前" : ""}</strong><small>{formatAdminTime(rule.createdAt)} · 基础 {rule.costs.standardGeneration} 积分</small></span></div>)}</div></aside>
        </div>
      )}
    </section>
  );
}
