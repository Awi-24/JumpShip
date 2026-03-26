"use client";

import { useState, useEffect } from "react";
import { Application, applicationsApi } from "@/lib/api";
import {
  Trash2,
  ExternalLink,
  ChevronDown,
  Loader2,
  Brain,
  CheckCircle2,
  Clock,
  XCircle,
  Briefcase,
  Star,
  Send,
  MessageSquare,
  RefreshCw,
} from "lucide-react";
import clsx from "clsx";

const STATUS_CONFIG: Record<string, { label: string; color: string; dot: string; icon: React.ElementType }> = {
  saved:        { label: "Salva",        color: "bg-taupe-50 text-taupe border-taupe-200",          dot: "bg-taupe",          icon: Briefcase },
  analyzing:    { label: "Analisando",   color: "bg-blue-50 text-blue-600 border-blue-100",          dot: "bg-blue-400",       icon: Brain },
  approved:     { label: "Aprovada",     color: "bg-violet-50 text-violet-600 border-violet-100",    dot: "bg-violet-500",     icon: CheckCircle2 },
  applying:     { label: "Candidatando", color: "bg-amber-50 text-amber-600 border-amber-100",       dot: "bg-amber-400",      icon: Send },
  applied:      { label: "Aplicada",     color: "bg-teal-50 text-teal-600 border-teal-100",          dot: "bg-teal-500",       icon: CheckCircle2 },
  interviewing: { label: "Entrevista",   color: "bg-indigo-50 text-indigo-600 border-indigo-100",    dot: "bg-indigo-500",     icon: MessageSquare },
  rejected:     { label: "Recusada",     color: "bg-red-50 text-red-600 border-red-100",             dot: "bg-red-400",        icon: XCircle },
  offered:      { label: "Oferta",       color: "bg-emerald-50 text-emerald-700 border-emerald-100", dot: "bg-emerald-500",    icon: Star },
};

const STATUS_ORDER = ["saved", "approved", "applying", "applied", "interviewing", "offered", "rejected"];

export default function DashboardPage() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [stats, setStats] = useState<{ total: number; by_status: Record<string, number> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [appsRes, statsRes] = await Promise.all([
        applicationsApi.list(),
        applicationsApi.stats(),
      ]);
      setApplications(appsRes.data.applications);
      setStats(statsRes.data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  async function changeStatus(app: Application, newStatus: string) {
    setUpdatingId(app.id);
    try {
      await applicationsApi.updateStatus(app.id, newStatus);
      setApplications((prev) =>
        prev.map((a) => (a.id === app.id ? { ...a, status: newStatus } : a))
      );
      if (stats) {
        const ns = { ...stats.by_status };
        ns[app.status] = (ns[app.status] ?? 1) - 1;
        ns[newStatus] = (ns[newStatus] ?? 0) + 1;
        setStats({ ...stats, by_status: ns });
      }
    } catch { /* ignore */ }
    finally { setUpdatingId(null); }
  }

  async function deleteApp(id: string) {
    if (!confirm("Remover esta candidatura do rastreador?")) return;
    try {
      await applicationsApi.delete(id);
      setApplications((prev) => prev.filter((a) => a.id !== id));
    } catch { /* ignore */ }
  }

  const filtered = filterStatus === "all"
    ? applications
    : applications.filter((a) => a.status === filterStatus);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Candidaturas</h1>
          <p className="text-sm text-taupe mt-0.5">
            Acompanhe todas as vagas salvas e candidaturas enviadas
          </p>
        </div>
        <button
          onClick={loadData}
          className="text-xs border border-taupe-200 text-taupe hover:border-coral hover:text-coral px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
        >
          <RefreshCw className={clsx("w-3 h-3", loading && "animate-spin")} />
          Atualizar
        </button>
      </div>

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Total" value={stats.total} accent="text-gray-700" />
          <StatCard label="Aplicadas" value={stats.by_status.applied ?? 0} accent="text-teal-600" />
          <StatCard label="Entrevistas" value={stats.by_status.interviewing ?? 0} accent="text-indigo-600" />
          <StatCard label="Ofertas" value={stats.by_status.offered ?? 0} accent="text-emerald-600" />
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide flex-wrap">
        <FilterChip
          label="Todas"
          count={stats?.total ?? 0}
          active={filterStatus === "all"}
          onClick={() => setFilterStatus("all")}
        />
        {STATUS_ORDER.map((s) => (
          <FilterChip
            key={s}
            label={STATUS_CONFIG[s]?.label ?? s}
            count={stats?.by_status[s] ?? 0}
            active={filterStatus === s}
            dot={STATUS_CONFIG[s]?.dot}
            onClick={() => setFilterStatus(s)}
          />
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-taupe">
          <Loader2 className="w-5 h-5 animate-spin text-coral" />
          <span className="text-sm">Carregando…</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center text-taupe gap-3">
          <div className="w-14 h-14 bg-white border border-taupe-100 rounded-2xl flex items-center justify-center shadow-sm">
            <Briefcase className="w-7 h-7 text-coral opacity-40" />
          </div>
          <div>
            <p className="font-medium text-gray-600 text-sm">Nenhuma candidatura ainda</p>
            <p className="text-xs text-taupe mt-1">
              Busque vagas e clique em "Rastrear" para adicioná-las aqui.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filtered.map((app) => (
            <AppRow
              key={app.id}
              app={app}
              updating={updatingId === app.id}
              onStatusChange={(s) => changeStatus(app, s)}
              onDelete={() => deleteApp(app.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="bg-white border border-taupe-100 rounded-2xl px-5 py-4">
      <p className="text-xs text-taupe">{label}</p>
      <p className={clsx("text-3xl font-bold mt-0.5 tracking-tight", accent)}>{value}</p>
    </div>
  );
}

function FilterChip({
  label, count, active, dot, onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  dot?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all duration-150 border",
        active
          ? "bg-coral text-white border-coral shadow-sm"
          : "border-taupe-200 text-taupe bg-white hover:border-coral/50 hover:text-gray-700"
      )}
    >
      {dot && !active && (
        <span className={clsx("w-1.5 h-1.5 rounded-full flex-shrink-0", dot)} />
      )}
      {label}
      <span
        className={clsx(
          "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
          active ? "bg-white/20 text-white" : "bg-taupe-100 text-taupe"
        )}
      >
        {count}
      </span>
    </button>
  );
}

function AppRow({
  app, updating, onStatusChange, onDelete,
}: {
  app: Application;
  updating: boolean;
  onStatusChange: (s: string) => void;
  onDelete: () => void;
}) {
  const cfg = STATUS_CONFIG[app.status] ?? STATUS_CONFIG.saved;
  const Icon = cfg.icon;

  return (
    <div className="bg-white border border-taupe-100 rounded-2xl px-5 py-4 flex items-center gap-4 hover:border-taupe-200 hover:shadow-sm transition-all duration-150">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-semibold text-gray-900 text-sm truncate">{app.job_title}</h3>
          <span className={clsx("flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium border", cfg.color)}>
            <Icon className="w-3 h-3" />
            {cfg.label}
          </span>
        </div>
        <p className="text-xs text-taupe mt-0.5">
          {app.company_name ?? "—"}
          {app.site && (
            <span className="ml-2 capitalize">· {app.site}</span>
          )}
          {app.applied_at && (
            <span className="ml-2">
              · <Clock className="w-2.5 h-2.5 inline-block mr-0.5" />
              {new Date(app.applied_at).toLocaleDateString("pt-BR")}
            </span>
          )}
        </p>
        {app.notes && (
          <p className="text-xs text-taupe-400 mt-1 italic truncate">{app.notes}</p>
        )}
      </div>

      {/* Ações */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {updating ? (
          <Loader2 className="w-4 h-4 animate-spin text-coral" />
        ) : (
          <div className="relative">
            <select
              value={app.status}
              onChange={(e) => onStatusChange(e.target.value)}
              className="appearance-none border border-taupe-200 text-xs text-gray-700 rounded-lg px-3 py-1.5 pr-6 focus:outline-none focus:ring-2 focus:ring-coral/30 focus:border-coral cursor-pointer bg-white transition-colors hover:border-taupe-400"
            >
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {STATUS_CONFIG[s]?.label ?? s}
                </option>
              ))}
            </select>
            <ChevronDown className="w-3 h-3 text-taupe absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        )}
        {app.job_url && (
          <a
            href={app.job_url}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 text-taupe-300 hover:text-coral rounded-lg hover:bg-coral-50 transition-colors"
            title="Abrir vaga"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        )}
        <button
          onClick={onDelete}
          className="p-1.5 text-taupe-300 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors"
          title="Remover"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
