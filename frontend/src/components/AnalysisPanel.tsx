"use client";

import { useState } from "react";
import { Analysis, analysisApi, Job } from "@/lib/api";
import {
  Sparkles,
  CheckCircle2,
  XCircle,
  Lightbulb,
  FileText,
  Loader2,
  ChevronDown,
  ChevronUp,
  Download,
  AlertCircle,
  RefreshCcw,
} from "lucide-react";
import clsx from "clsx";

interface AnalysisPanelProps {
  job: Job;
  existingAnalysis?: Analysis | null;
  onAnalysisComplete?: (analysis: Analysis) => void;
}

function ScoreRing({ score }: { score: number }) {
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const filled = (score / 100) * circumference;

  const color =
    score >= 75 ? "#059669"   // emerald
    : score >= 50 ? "#D97706" // amber
    : "#DC2626";               // red

  const textColor =
    score >= 75 ? "text-emerald-700"
    : score >= 50 ? "text-amber-600"
    : "text-red-600";

  const label =
    score >= 75 ? "Ótimo" : score >= 50 ? "Regular" : "Baixo";

  return (
    <div className="flex flex-col items-center gap-1 flex-shrink-0">
      <div className="relative w-24 h-24">
        <svg className="w-24 h-24 -rotate-90" viewBox="0 0 88 88">
          {/* Track */}
          <circle
            cx="44" cy="44" r={radius}
            fill="none"
            stroke="#E8E6E2"
            strokeWidth="7"
          />
          {/* Progress */}
          <circle
            cx="44" cy="44" r={radius}
            fill="none"
            stroke={color}
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={`${filled} ${circumference}`}
            style={{ transition: "stroke-dasharray 0.6s ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={clsx("text-2xl font-bold leading-none", textColor)}>{score}</span>
          <span className="text-[10px] text-taupe font-medium mt-0.5">/100</span>
        </div>
      </div>
      <span className={clsx("text-xs font-semibold", textColor)}>{label}</span>
    </div>
  );
}

export default function AnalysisPanel({
  job,
  existingAnalysis,
  onAnalysisComplete,
}: AnalysisPanelProps) {
  const [analysis, setAnalysis] = useState<Analysis | null>(existingAnalysis ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTailored, setShowTailored] = useState(false);
  const [tailoredResume, setTailoredResume] = useState<string | null>(null);
  const [generatingTailored, setGeneratingTailored] = useState(false);

  async function runAnalysis() {
    setLoading(true);
    setError(null);
    try {
      const { data } = await analysisApi.analyse({
        job_id: job.id,
        job_title: job.title,
        company_name: job.company_name,
        job_description: job.description,
      });
      setAnalysis(data);
      onAnalysisComplete?.(data);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } }; message?: string };
      setError(
        err.response?.data?.detail ??
          err.message ??
          "Falha na análise. Verifique se o currículo foi enviado e a chave de IA está configurada em Configurações."
      );
    } finally {
      setLoading(false);
    }
  }

  async function getTailored() {
    if (!analysis) return;
    setGeneratingTailored(true);
    try {
      const { data } = await analysisApi.generateTailored(analysis.id);
      setTailoredResume(data.tailored_resume);
      setShowTailored(true);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } }; message?: string };
      setError(err.response?.data?.detail ?? "Falha ao gerar currículo adaptado.");
    } finally {
      setGeneratingTailored(false);
    }
  }

  function downloadTailored() {
    if (!tailoredResume) return;
    const blob = new Blob([tailoredResume], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `curriculo-${job.company_name ?? "vaga"}-${job.title}.txt`.replace(/\s+/g, "-");
    a.click();
    URL.revokeObjectURL(url);
  }

  /* ── Estado inicial ─── */
  if (!analysis && !loading) {
    return (
      <div className="flex flex-col items-center gap-5 py-10 px-4 text-center">
        <div className="w-14 h-14 bg-coral-50 rounded-2xl flex items-center justify-center">
          <Sparkles className="w-7 h-7 text-coral/70" />
        </div>
        <div>
          <h3 className="font-semibold text-gray-900 text-sm">Análise com IA</h3>
          <p className="text-xs text-taupe mt-1.5 max-w-xs leading-relaxed">
            Compare seu currículo com esta vaga e receba uma pontuação de compatibilidade com pontos fortes, lacunas e sugestões.
          </p>
        </div>
        {error && (
          <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-100 rounded-xl px-4 py-3 w-full text-left">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
        <button
          onClick={runAnalysis}
          className="bg-coral hover:bg-coral-600 text-white font-medium px-5 py-2.5 rounded-xl transition-colors flex items-center gap-2 text-sm"
        >
          <Sparkles className="w-4 h-4" />
          Analisar Currículo
        </button>
      </div>
    );
  }

  /* ── Loading ─── */
  if (loading) {
    return (
      <div className="flex flex-col items-center gap-3 py-14">
        <div className="w-12 h-12 bg-coral-50 rounded-2xl flex items-center justify-center">
          <Loader2 className="w-6 h-6 text-coral animate-spin" />
        </div>
        <p className="text-sm text-taupe">Analisando com IA…</p>
      </div>
    );
  }

  if (!analysis) return null;

  /* ── Resultado ─── */
  return (
    <div className="space-y-3">
      {/* Score + Resumo */}
      <div className="flex items-center gap-5 p-4 bg-sand rounded-2xl border border-taupe-100">
        <ScoreRing score={Math.round(analysis.score)} />
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 text-sm">Compatibilidade</h3>
          {analysis.summary && (
            <p className="text-xs text-gray-600 mt-1.5 leading-relaxed">{analysis.summary}</p>
          )}
          <button
            onClick={runAnalysis}
            className="mt-2 text-xs text-coral hover:underline font-medium flex items-center gap-1"
          >
            <RefreshCcw className="w-3 h-3" /> Re-analisar
          </button>
        </div>
      </div>

      {/* Pontos Fortes */}
      {analysis.strengths.length > 0 && (
        <AnalysisSection
          icon={<CheckCircle2 className="w-4 h-4 text-emerald-600" />}
          title="Pontos Fortes"
          items={analysis.strengths}
          bgColor="bg-emerald-50"
          borderColor="border-emerald-100"
        />
      )}

      {/* Lacunas */}
      {analysis.gaps.length > 0 && (
        <AnalysisSection
          icon={<XCircle className="w-4 h-4 text-red-500" />}
          title="Lacunas"
          items={analysis.gaps}
          bgColor="bg-red-50"
          borderColor="border-red-100"
        />
      )}

      {/* Sugestões */}
      {analysis.suggestions.length > 0 && (
        <AnalysisSection
          icon={<Lightbulb className="w-4 h-4 text-amber-500" />}
          title="Sugestões"
          items={analysis.suggestions}
          bgColor="bg-amber-50"
          borderColor="border-amber-100"
        />
      )}

      {/* Keywords */}
      {(analysis.keywords_matched?.length || analysis.keywords_missing?.length) ? (
        <div className="space-y-2.5">
          {analysis.keywords_matched?.length ? (
            <div>
              <p className="text-[11px] font-semibold text-taupe-500 mb-2 uppercase tracking-wider">
                Keywords encontradas
              </p>
              <div className="flex flex-wrap gap-1.5">
                {analysis.keywords_matched.map((k) => (
                  <span
                    key={k}
                    className="text-[11px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full border border-emerald-100 font-medium"
                  >
                    {k}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {analysis.keywords_missing?.length ? (
            <div>
              <p className="text-[11px] font-semibold text-taupe-500 mb-2 uppercase tracking-wider">
                Keywords ausentes
              </p>
              <div className="flex flex-wrap gap-1.5">
                {analysis.keywords_missing.map((k) => (
                  <span
                    key={k}
                    className="text-[11px] bg-red-50 text-red-600 px-2 py-0.5 rounded-full border border-red-100 font-medium"
                  >
                    {k}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Currículo Adaptado */}
      <div className="border-t border-taupe-100 pt-3">
        {!tailoredResume ? (
          <button
            onClick={getTailored}
            disabled={generatingTailored}
            className="w-full flex items-center justify-center gap-2 border border-coral text-coral hover:bg-coral-50 font-medium px-4 py-2.5 rounded-xl transition-colors text-sm disabled:opacity-60"
          >
            {generatingTailored ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Gerando…</>
            ) : (
              <><FileText className="w-4 h-4" /> Gerar Currículo Adaptado</>
            )}
          </button>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <button
                onClick={() => setShowTailored(!showTailored)}
                className="flex items-center gap-1.5 text-sm font-semibold text-gray-700"
              >
                {showTailored ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                Currículo Adaptado
              </button>
              <button
                onClick={downloadTailored}
                className="flex items-center gap-1 text-xs text-coral hover:underline font-medium"
              >
                <Download className="w-3 h-3" /> Baixar
              </button>
            </div>
            {showTailored && (
              <pre className="text-xs bg-sand rounded-xl p-4 whitespace-pre-wrap max-h-64 overflow-y-auto border border-taupe-100 leading-relaxed text-gray-700">
                {tailoredResume}
              </pre>
            )}
          </div>
        )}
        {error && (
          <p className="text-xs text-red-600 mt-2">{error}</p>
        )}
      </div>
    </div>
  );
}

function AnalysisSection({
  icon, title, items, bgColor, borderColor,
}: {
  icon: React.ReactNode;
  title: string;
  items: string[];
  bgColor: string;
  borderColor: string;
}) {
  return (
    <div className={clsx("rounded-xl p-3.5 border", bgColor, borderColor)}>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-sm font-semibold text-gray-800">{title}</span>
      </div>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="text-xs text-gray-700 flex gap-2 leading-relaxed">
            <span className="text-taupe-300 flex-shrink-0 mt-0.5">•</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
