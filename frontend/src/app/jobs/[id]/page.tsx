"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Job, jobsApi, analysisApi, Analysis } from "@/lib/api";
import AnalysisPanel from "@/components/AnalysisPanel";
import { ArrowLeft, ExternalLink, Loader2, MapPin, Wifi, Zap, Calendar } from "lucide-react";
import ReactMarkdown from "react-markdown";
import clsx from "clsx";

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [job, setJob] = useState<Job | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"description" | "analysis">("description");

  useEffect(() => {
    if (!id) return;
    jobsApi.getById(id)
      .then(({ data }) => {
        setJob(data);
        return analysisApi.getByJob(id).catch(() => null);
      })
      .then((res) => { if (res) setAnalysis(res.data); })
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="w-6 h-6 animate-spin text-coral" />
    </div>
  );

  if (!job) return (
    <div className="text-center py-16 text-taupe text-sm">Vaga não encontrada.</div>
  );

  const locationStr = job.location
    ? typeof job.location === "string"
      ? job.location
      : [job.location.city, job.location.state, job.location.country].filter(Boolean).join(", ")
    : "";

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <button
        onClick={() => router.back()}
        className="flex items-center gap-1.5 text-sm text-taupe hover:text-gray-700 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> Voltar
      </button>

      <div className="bg-white rounded-2xl border border-taupe-100 p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-gray-900">{job.title}</h1>
        <p className="text-taupe mt-1 text-sm">{job.company_name}</p>
        <div className="flex flex-wrap gap-3 mt-3 text-xs text-taupe">
          {locationStr && (
            <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{locationStr}</span>
          )}
          {job.is_remote && (
            <span className="flex items-center gap-1 text-teal-600 bg-teal-50 border border-teal-100 px-2 py-0.5 rounded-full">
              <Wifi className="w-3 h-3" />Remoto
            </span>
          )}
          {!!(job.easy_apply || (job as Record<string, unknown>).easy_apply) && (
            <span className="flex items-center gap-1 text-amber-600 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-full">
              <Zap className="w-3 h-3" />Easy Apply
            </span>
          )}
          {job.date_posted && (
            <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{job.date_posted}</span>
          )}
        </div>
        <div className="flex gap-2 mt-4">
          <a
            href={job.job_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 bg-coral hover:bg-coral-600 text-white text-sm font-medium px-5 py-2 rounded-xl transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" /> Candidatar-se
          </a>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0.5 border-b border-taupe-100 px-1">
        {(["description", "analysis"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={clsx(
              "relative px-4 py-3 text-sm font-medium transition-colors",
              tab === t ? "text-gray-900" : "text-taupe hover:text-gray-700"
            )}
          >
            {t === "description" ? "Descrição" : "Análise IA"}
            {tab === t && (
              <span className="absolute bottom-0 left-4 right-4 h-[2px] bg-coral rounded-full" />
            )}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-taupe-100 p-6 shadow-sm">
        {tab === "description" ? (
          job.description
            ? (
              <div className="prose prose-sm max-w-none text-gray-700 prose-headings:font-semibold prose-a:text-coral leading-relaxed">
                <ReactMarkdown>{job.description}</ReactMarkdown>
              </div>
            )
            : <p className="text-taupe text-sm italic">Descrição não disponível.</p>
        ) : (
          <AnalysisPanel job={job} existingAnalysis={analysis} onAnalysisComplete={setAnalysis} />
        )}
      </div>
    </div>
  );
}
