"use client";

import { Job } from "@/lib/api";
import {
  MapPin,
  Clock,
  DollarSign,
  Wifi,
  Bookmark,
  BookmarkCheck,
  Zap,
} from "lucide-react";
import clsx from "clsx";

interface JobCardProps {
  job: Job;
  saved?: boolean;
  onSave?: (job: Job) => void;
  onSelect?: (job: Job) => void;
  selected?: boolean;
}

const SITE_LABELS: Record<string, { label: string; color: string }> = {
  linkedin:     { label: "LinkedIn",      color: "bg-blue-50 text-blue-600 border-blue-100" },
  indeed:       { label: "Indeed",        color: "bg-orange-50 text-orange-600 border-orange-100" },
  glassdoor:    { label: "Glassdoor",     color: "bg-emerald-50 text-emerald-600 border-emerald-100" },
  google:       { label: "Google",        color: "bg-red-50 text-red-600 border-red-100" },
  zip_recruiter:{ label: "ZipRecruiter",  color: "bg-purple-50 text-purple-600 border-purple-100" },
  gupy:         { label: "Gupy",          color: "bg-coral-50 text-coral border-coral-100" },
  catho:        { label: "Catho",         color: "bg-amber-50 text-amber-600 border-amber-100" },
  "vagas.com.br":{ label: "Vagas",        color: "bg-teal-50 text-teal-600 border-teal-100" },
};

const AVATAR_PALETTE = [
  "bg-coral-100 text-coral-700",
  "bg-blue-100 text-blue-700",
  "bg-violet-100 text-violet-700",
  "bg-teal-100 text-teal-700",
  "bg-amber-100 text-amber-700",
  "bg-emerald-100 text-emerald-700",
];

function formatSalary(job: Job): string | null {
  const min = job.min_salary ?? (job as Record<string, unknown>).min_amount as number;
  const max = job.max_salary ?? (job as Record<string, unknown>).max_amount as number;
  const interval = job.salary_interval ?? (job as Record<string, unknown>).interval as string;
  const currency = job.currency ?? "USD";
  if (!min && !max) return null;
  const fmt = (n: number) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: currency || "BRL",
      maximumFractionDigits: 0,
    }).format(n);
  const range = min && max ? `${fmt(min)} – ${fmt(max)}` : min ? `${fmt(min)}+` : `até ${fmt(max!)}`;
  const period = interval === "yearly" ? "/ano" : interval === "monthly" ? "/mês" : interval === "hourly" ? "/h" : interval ? `/${interval}` : "";
  return range + period;
}

function formatLocation(job: Job): string {
  const loc = job.location;
  if (!loc) return "";
  if (typeof loc === "string") return loc;
  const parts = [loc.city, loc.state, loc.country].filter(Boolean);
  return parts.join(", ");
}

function timeAgo(dateStr?: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const diff = Date.now() - d.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Hoje";
  if (days === 1) return "Ontem";
  if (days < 7) return `${days} dias atrás`;
  if (days < 30) return `${Math.floor(days / 7)}s atrás`;
  return `${Math.floor(days / 30)}m atrás`;
}

function CompanyAvatar({ name }: { name?: string }) {
  const letter = (name ?? "?")[0]?.toUpperCase() ?? "?";
  const colorIdx = letter.charCodeAt(0) % AVATAR_PALETTE.length;
  return (
    <div
      className={clsx(
        "w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 font-semibold text-sm select-none",
        AVATAR_PALETTE[colorIdx]
      )}
    >
      {letter}
    </div>
  );
}

export default function JobCard({ job, saved, onSave, onSelect, selected }: JobCardProps) {
  const salary = formatSalary(job);
  const location = formatLocation(job);
  const siteKey = (job.site ?? "").toLowerCase();
  const siteInfo = SITE_LABELS[siteKey] ?? { label: job.site ?? "", color: "bg-taupe-50 text-taupe border-taupe-200" };
  const posted = timeAgo(job.date_posted ?? (job as Record<string, unknown>).date_posted as string);
  const isRemote = job.is_remote ?? !!(job as Record<string, unknown>).is_remote;
  const isEasyApply = !!(job.easy_apply || (job as Record<string, unknown>).easy_apply);

  return (
    <div
      onClick={() => onSelect?.(job)}
      className={clsx(
        "bg-white rounded-2xl border p-4 cursor-pointer transition-all duration-150",
        "hover:shadow-[0_2px_16px_rgba(0,0,0,0.07)]",
        selected
          ? "border-coral/50 shadow-[0_2px_12px_rgba(193,95,60,0.12)] ring-1 ring-coral/20"
          : "border-taupe-100 hover:border-taupe-200"
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          {job.company_logo ? (
            <img
              src={job.company_logo}
              alt={job.company_name ?? ""}
              className="w-9 h-9 rounded-xl object-contain border border-taupe-100 flex-shrink-0 bg-white"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <CompanyAvatar name={job.company_name} />
          )}
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-900 text-sm leading-snug line-clamp-2">
              {job.title}
            </h3>
            <p className="text-taupe text-xs mt-0.5 truncate">
              {job.company_name ?? "Empresa não informada"}
            </p>
          </div>
        </div>

        {onSave && (
          <button
            onClick={(e) => { e.stopPropagation(); onSave(job); }}
            className={clsx(
              "flex-shrink-0 p-1.5 rounded-lg transition-colors",
              saved
                ? "text-coral bg-coral-50"
                : "text-taupe-300 hover:text-coral hover:bg-coral-50"
            )}
            title={saved ? "Salva" : "Salvar vaga"}
          >
            {saved
              ? <BookmarkCheck className="w-4 h-4" />
              : <Bookmark className="w-4 h-4" />}
          </button>
        )}
      </div>

      {/* Badges */}
      <div className="flex flex-wrap items-center gap-1.5 mt-3">
        {job.site && (
          <span className={clsx("text-[11px] font-medium px-2 py-0.5 rounded-full border", siteInfo.color)}>
            {siteInfo.label}
          </span>
        )}
        {isRemote && (
          <span className="flex items-center gap-1 text-[11px] bg-teal-50 text-teal-600 px-2 py-0.5 rounded-full font-medium border border-teal-100">
            <Wifi className="w-3 h-3" /> Remoto
          </span>
        )}
        {isEasyApply && (
          <span className="flex items-center gap-1 text-[11px] bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full font-medium border border-amber-100">
            <Zap className="w-3 h-3" /> Easy Apply
          </span>
        )}
        {job.job_type && (
          <span className="text-[11px] bg-taupe-50 text-taupe px-2 py-0.5 rounded-full border border-taupe-100 capitalize">
            {job.job_type === "fulltime" ? "Integral" : job.job_type === "parttime" ? "Meio período" : job.job_type === "internship" ? "Estágio" : job.job_type === "contract" ? "Contrato" : job.job_type}
          </span>
        )}
      </div>

      {/* Meta info */}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-taupe">
        {location && (
          <span className="flex items-center gap-1">
            <MapPin className="w-3 h-3 flex-shrink-0" />{location}
          </span>
        )}
        {salary && (
          <span className="flex items-center gap-1 text-emerald-700 font-semibold">
            <DollarSign className="w-3 h-3 flex-shrink-0" />{salary}
          </span>
        )}
        {posted && (
          <span className="flex items-center gap-1 ml-auto">
            <Clock className="w-3 h-3 flex-shrink-0" />{posted}
          </span>
        )}
      </div>
    </div>
  );
}
