"use client";

import { useState, useEffect, useRef } from "react";
import { Resume, resumeApi } from "@/lib/api";
import {
  Upload,
  FileText,
  Trash2,
  CheckCircle,
  AlertCircle,
  Loader2,
  RefreshCw,
} from "lucide-react";
import clsx from "clsx";

export default function ResumePage() {
  const [resume, setResume] = useState<Resume | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchResume();
  }, []);

  async function fetchResume() {
    setLoading(true);
    try {
      const { data } = await resumeApi.get();
      setResume(data);
    } catch {
      setResume(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleUpload(file: File) {
    if (!file) return;
    setUploading(true);
    setError(null);
    setSuccess(null);
    try {
      await resumeApi.upload(file);
      setSuccess("Currículo enviado e processado com sucesso!");
      fetchResume();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } }; message?: string };
      setError(err.response?.data?.detail ?? err.message ?? "Falha no upload.");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Remover o currículo? Você precisará reenviar antes de rodar análises de IA.")) return;
    try {
      await resumeApi.delete();
      setResume(null);
      setSuccess("Currículo removido.");
    } catch (e: unknown) {
      const err = e as { message?: string };
      setError(err.message ?? "Falha ao remover.");
    }
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleUpload(file);
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Currículo</h1>
        <p className="text-sm text-taupe mt-1">
          Envie seu currículo em PDF ou DOCX para habilitar a análise de compatibilidade com IA.
        </p>
      </div>

      {/* Upload Zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => fileRef.current?.click()}
        className={clsx(
          "relative border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all duration-150",
          dragOver
            ? "border-coral bg-coral-50"
            : "border-taupe-200 hover:border-coral/50 hover:bg-coral-50/40"
        )}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.docx,.doc"
          onChange={onFileChange}
          className="hidden"
        />
        {uploading ? (
          <div className="flex flex-col items-center gap-3">
            <div className="w-12 h-12 bg-coral-50 rounded-2xl flex items-center justify-center">
              <Loader2 className="w-6 h-6 text-coral animate-spin" />
            </div>
            <p className="text-sm text-taupe">Enviando e processando…</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="w-12 h-12 bg-white border border-taupe-100 rounded-2xl flex items-center justify-center shadow-sm">
              <Upload className="w-5 h-5 text-taupe" />
            </div>
            <div>
              <p className="font-medium text-gray-700 text-sm">
                Arraste seu currículo aqui ou{" "}
                <span className="text-coral">clique para selecionar</span>
              </p>
              <p className="text-xs text-taupe mt-1">PDF ou DOCX · Máx. 10 MB</p>
            </div>
          </div>
        )}
      </div>

      {/* Mensagens de feedback */}
      {success && (
        <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3">
          <CheckCircle className="w-4 h-4 flex-shrink-0" />
          {success}
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Currículo ativo */}
      {loading ? (
        <div className="flex items-center gap-2 text-taupe py-4">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Carregando…</span>
        </div>
      ) : resume ? (
        <div className="bg-white border border-taupe-100 rounded-2xl overflow-hidden shadow-sm">
          {/* Info header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-taupe-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-coral-50 rounded-xl flex items-center justify-center">
                <FileText className="w-5 h-5 text-coral/70" />
              </div>
              <div>
                <p className="font-medium text-gray-900 text-sm">{resume.filename}</p>
                <p className="text-xs text-taupe mt-0.5">
                  {resume.char_count.toLocaleString("pt-BR")} caracteres ·{" "}
                  Enviado em {new Date(resume.uploaded_at).toLocaleDateString("pt-BR")}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}
                className="flex items-center gap-1.5 text-xs border border-taupe-200 text-taupe hover:border-coral hover:text-coral px-3 py-1.5 rounded-lg transition-colors"
              >
                <RefreshCw className="w-3 h-3" /> Substituir
              </button>
              <button
                onClick={handleDelete}
                className="flex items-center gap-1.5 text-xs border border-red-100 text-red-500 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors"
              >
                <Trash2 className="w-3 h-3" /> Remover
              </button>
            </div>
          </div>

          {/* Preview do texto extraído */}
          <div className="p-5">
            <p className="text-xs font-medium text-taupe mb-2.5 uppercase tracking-wide">
              Prévia do texto extraído
            </p>
            <pre className="text-xs text-gray-700 bg-sand rounded-xl p-4 whitespace-pre-wrap max-h-80 overflow-y-auto leading-relaxed border border-taupe-100 scrollbar-hide">
              {resume.content.slice(0, 2000)}
              {resume.content.length > 2000 && "\n\n… (truncado para prévia)"}
            </pre>
          </div>
        </div>
      ) : (
        <div className="text-center text-taupe py-6 text-sm">
          Nenhum currículo enviado. Faça o upload acima para começar.
        </div>
      )}
    </div>
  );
}
