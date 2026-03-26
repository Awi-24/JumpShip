"use client";

import { useState } from "react";
import { Job, Analysis, jobsApi, applicationsApi } from "@/lib/api";
import AnalysisPanel from "./AnalysisPanel";
import {
  X,
  ExternalLink,
  Bookmark,
  BookmarkCheck,
  MapPin,
  Calendar,
  DollarSign,
  Wifi,
  Zap,
  PlusCircle,
  CheckCircle,
  Briefcase,
  Building2,
} from "lucide-react";
import clsx from "clsx";
import ReactMarkdown from "react-markdown";

interface JobDetailPanelProps {
  job: Job | null;
  onClose: () => void;
  savedIds: Set<string | undefined>;
  onSave: (job: Job) => void;
}

const TABS = ["Descrição", "Análise IA"] as const;
type Tab = (typeof TABS)[number];

export default function JobDetailPanel({
  job,
  onClose,
  savedIds,
  onSave,
}: JobDetailPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>("Descrição");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [tracked, setTracked] = useState(false);
  const [trackMsg, setTrackMsg] = useState<string | null>(null);

  if (!job) {
    return (
      <div className="hidden lg:flex flex-col items-center justify-center h-full text-center text-taupe gap-4 bg-white rounded-2xl border border-taupe-100">
        <div className="w-14 h-14 rounded-2xl bg-sand flex items-center justify-center">
          <Briefcase className="w-7 h-7 text-coral opacity-40" />
        </div>
        <div>
          <p className="font-medium text-gray-600 text-sm">Selecione uma vaga</p>
          <p className="text-xs text-taupe mt-1">Clique em uma vaga para ver os detalhes</p>
        </div>
      </div>
    );
  }

  const isSaved = savedIds.has(job.id) || savedIds.has(job.job_url);
  const isRemote = job.is_remote ?? !!(job as Record<string, unknown>).is_remote;
  const isEasyApply = !!(job.easy_apply || (job as Record<string, unknown>).easy_apply);

  const locationStr =
    typeof job.location === "string"
      ? job.location
      : [job.location?.city, job.location?.state, job.location?.country]
          .filter(Boolean)
          .join(", ");

  async function handleTrack() {
    if (!job) return;
    try {
      if (!job.id) {
        await jobsApi.save({
          title: job.title,
          company_name: job.company_name,
          job_url: job.job_url,
          description: job.description,
          site: job.site,
          easy_apply: !!(job.easy_apply || (job as Record<string, unknown>).easy_apply),
          raw_data: job as Record<string, unknown>,
        });
      }
      await applicationsApi.create({
        job_id: job.id,
        job_title: job.title,
        company_name: job.company_name,
        job_url: job.job_url,
        site: job.site,
        is_easy_apply: !!(job.easy_apply || (job as Record<string, unknown>).easy_apply),
        analysis_id: analysis?.id,
      });
      setTracked(true);
      setTrackMsg("Adicionado ao rastreador!");
    } catch {
      setTrackMsg("Erro ao adicionar. Tente novamente.");
    }
    setTimeout(() => setTrackMsg(null), 3000);
  }

  return (
    <div className="flex flex-col h-full bg-white rounded-2xl border border-taupe-100 overflow-hidden shadow-sm">
      {/* Header */}
      <div className="p-5 border-b border-taupe-100 flex-shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            {job.company_logo ? (
              <img
                src={job.company_logo}
                alt={job.company_name ?? ""}
                className="w-12 h-12 rounded-xl object-contain border border-taupe-100 flex-shrink-0 bg-white"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            ) : (
              <div className="w-12 h-12 rounded-xl bg-coral-50 flex items-center justify-center flex-shrink-0">
                <Building2 className="w-6 h-6 text-coral/50" />
              </div>
            )}
            <div className="min-w-0">
              <h2 className="font-semibold text-gray-900 text-base leading-tight">{job.title}</h2>
              <p className="text-sm text-taupe mt-0.5">{job.company_name ?? "Empresa não informada"}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-taupe-300 hover:text-gray-600 flex-shrink-0 p-1.5 rounded-lg hover:bg-sand transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Meta row */}
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3 text-xs text-taupe">
          {locationStr && (
            <span className="flex items-center gap-1">
              <MapPin className="w-3 h-3" />{locationStr}
            </span>
          )}
          {job.date_posted && (
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />{job.date_posted}
            </span>
          )}
          {!!(job.min_salary || (job as Record<string, unknown>).min_amount) && (
            <span className="flex items-center gap-1 text-emerald-700 font-semibold">
              <DollarSign className="w-3 h-3" />
              {job.min_salary ?? (job as Record<string, unknown>).min_amount as number}
              {!!(job.max_salary || (job as Record<string, unknown>).max_amount) &&
                ` – ${job.max_salary ?? (job as Record<string, unknown>).max_amount as number}`}
              {job.salary_interval && ` / ${job.salary_interval}`}
            </span>
          )}
          {isRemote && (
            <span className="flex items-center gap-1 text-teal-600 font-medium bg-teal-50 px-2 py-0.5 rounded-full border border-teal-100">
              <Wifi className="w-3 h-3" />Remoto
            </span>
          )}
          {isEasyApply && (
            <span className="flex items-center gap-1 text-amber-600 font-medium bg-amber-50 px-2 py-0.5 rounded-full border border-amber-100">
              <Zap className="w-3 h-3" />Easy Apply
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 mt-4">
          <a
            href={job.job_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center gap-1.5 bg-coral hover:bg-coral-600 text-white text-sm font-medium py-2 rounded-xl transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Candidatar-se
          </a>
          <button
            onClick={() => onSave(job)}
            className={clsx(
              "px-3 py-2 rounded-xl border text-sm font-medium transition-colors flex items-center gap-1.5",
              isSaved
                ? "border-coral-200 bg-coral-50 text-coral"
                : "border-taupe-200 text-taupe-500 hover:border-coral hover:text-coral"
            )}
          >
            {isSaved ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
            {isSaved ? "Salva" : "Salvar"}
          </button>
          <button
            onClick={handleTrack}
            disabled={tracked}
            className={clsx(
              "px-3 py-2 rounded-xl border text-sm font-medium transition-colors flex items-center gap-1.5",
              tracked
                ? "border-emerald-200 bg-emerald-50 text-emerald-600"
                : "border-taupe-200 text-taupe-500 hover:border-emerald-400 hover:text-emerald-600"
            )}
          >
            {tracked
              ? <CheckCircle className="w-4 h-4" />
              : <PlusCircle className="w-4 h-4" />}
            Rastrear
          </button>
        </div>

        {trackMsg && (
          <p className="text-xs text-emerald-600 mt-2 font-medium">{trackMsg}</p>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-taupe-100 flex-shrink-0 px-1">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={clsx(
              "flex-1 text-sm py-3 transition-colors relative",
              activeTab === tab
                ? "text-gray-900 font-medium"
                : "text-taupe hover:text-gray-700"
            )}
          >
            {tab}
            {activeTab === tab && (
              <span className="absolute bottom-0 left-4 right-4 h-[2px] bg-coral rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5">
        {activeTab === "Descrição" ? (
          job.description ? (
            <div className="prose prose-sm max-w-none text-gray-700 prose-headings:text-gray-900 prose-headings:font-semibold prose-a:text-coral prose-strong:text-gray-900 leading-relaxed">
              <ReactMarkdown>{job.description}</ReactMarkdown>
            </div>
          ) : (
            <p className="text-sm text-taupe italic">Descrição não disponível.</p>
          )
        ) : (
          <AnalysisPanel
            job={job}
            existingAnalysis={analysis}
            onAnalysisComplete={setAnalysis}
          />
        )}
      </div>
    </div>
  );
}
