"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import {
  KeyRound,
  Eye,
  EyeOff,
  Save,
  AlertTriangle,
  CheckCircle,
  Loader2,
  User,
  Globe,
  ChevronDown,
  ChevronRight,
  Shield,
} from "lucide-react";
import clsx from "clsx";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AIKeys {
  anthropic:   string | null;
  openai:      string | null;
  gemini:      string | null;
  deepseek:    string | null;
  groq:        string | null;
  huggingface: string | null;
  mistral:     string | null;
  openrouter:  string | null;
  cohere:      string | null;
  ollama:      string | null;
  active_provider: string;
}

interface PlatformStatus {
  email: string | null;
  has_password: boolean;
}

interface UserProfile {
  name: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
}

const PROVIDERS = [
  {
    id: "anthropic",
    label: "Anthropic",
    model: "claude-sonnet-4-6",
    placeholder: "sk-ant-…",
    docsUrl: "https://console.anthropic.com/",
    color: "text-orange-600",
    free: false,
    description: "Melhor qualidade. Saída JSON garantida via tool_use.",
  },
  {
    id: "openai",
    label: "OpenAI",
    model: "gpt-4o-mini",
    placeholder: "sk-…",
    docsUrl: "https://platform.openai.com/api-keys",
    color: "text-emerald-600",
    free: false,
    description: "GPT-4o Mini — rápido e econômico.",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    model: "gemini-1.5-flash",
    placeholder: "AIzaSy…",
    docsUrl: "https://aistudio.google.com/app/apikey",
    color: "text-blue-600",
    free: false,
    description: "Gemini 1.5 Flash — contexto longo.",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    model: "deepseek-chat",
    placeholder: "sk-…",
    docsUrl: "https://platform.deepseek.com/api_keys",
    color: "text-violet-600",
    free: false,
    description: "Muito barato. Ótimo custo-benefício.",
  },
  {
    id: "groq",
    label: "Groq",
    model: "llama-3.3-70b-versatile",
    placeholder: "gsk_…",
    docsUrl: "https://console.groq.com/keys",
    color: "text-rose-600",
    free: true,
    description: "Inferência ultra-rápida. Limites diários generosos.",
  },
  {
    id: "huggingface",
    label: "Hugging Face",
    model: "Qwen/Qwen2.5-72B-Instruct",
    placeholder: "hf_…",
    docsUrl: "https://huggingface.co/settings/tokens",
    color: "text-amber-600",
    free: true,
    description: "Acesso a milhares de modelos open-source.",
  },
  {
    id: "mistral",
    label: "Mistral AI",
    model: "mistral-small-latest",
    placeholder: "…",
    docsUrl: "https://console.mistral.ai/api-keys",
    color: "text-cyan-600",
    free: true,
    description: "Tier gratuito para testes. Modelos europeus.",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    model: "llama-3.2-3b:free",
    placeholder: "sk-or-…",
    docsUrl: "https://openrouter.ai/settings/keys",
    color: "text-indigo-600",
    free: true,
    description: "Agregador com dezenas de modelos gratuitos.",
  },
  {
    id: "cohere",
    label: "Cohere",
    model: "command-r",
    placeholder: "…",
    docsUrl: "https://dashboard.cohere.com/api-keys",
    color: "text-teal-600",
    free: true,
    description: "Trial gratuito com bons rate limits.",
  },
  {
    id: "ollama",
    label: "Ollama (Local)",
    model: "qwen2.5:7b-instruct",
    placeholder: "qwen2.5:7b-instruct  (recomendado)",
    docsUrl: "https://ollama.com/library/qwen2.5",
    color: "text-gray-700",
    free: true,
    description: "Modelos locais sem internet. Recomendado: qwen2.5:7b-instruct",
  },
];

const PLATFORMS = [
  { id: "linkedin",     label: "LinkedIn",     icon: "🔗", loginUrl: "https://linkedin.com/login" },
  { id: "indeed",       label: "Indeed",       icon: "🔍", loginUrl: "https://indeed.com/account/login" },
  { id: "glassdoor",    label: "Glassdoor",    icon: "🪟", loginUrl: "https://glassdoor.com/profile/login_input.htm" },
  { id: "ziprecruiter", label: "ZipRecruiter", icon: "📋", loginUrl: "https://www.ziprecruiter.com/login" },
];

// ── Componente principal ───────────────────────────────────────────────────────

export default function SettingsPage() {
  const [aiKeys, setAiKeys] = useState<AIKeys>({
    anthropic: null, openai: null, gemini: null, deepseek: null,
    groq: null, huggingface: null, mistral: null, openrouter: null, cohere: null,
    ollama: null,
    active_provider: "anthropic",
  });
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [activeProvider, setActiveProvider] = useState("anthropic");
  const [ollamaStatus, setOllamaStatus] = useState<{ available: boolean; models: string[] }>({ available: false, models: [] });

  const [platforms, setPlatforms] = useState<Record<string, PlatformStatus>>({});
  const [platInputs, setPlatInputs] = useState<Record<string, { email: string; password: string }>>({});
  const [showPass, setShowPass] = useState<Record<string, boolean>>({});

  const [profile, setProfile] = useState<UserProfile>({ name: null, email: null, phone: null, linkedin_url: null });
  const [profileInput, setProfileInput] = useState({ name: "", email: "", phone: "", linkedin_url: "" });

  const [loading, setLoading] = useState(true);
  const [savingSection, setSavingSection] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ section: string; msg: string; ok: boolean } | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    ai: true, platforms: false, profile: false,
  });

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [keysRes, platRes, profRes, ollamaRes] = await Promise.all([
        api.get<AIKeys>("/api/settings/ai-keys"),
        api.get<Record<string, PlatformStatus>>("/api/settings/platforms"),
        api.get<UserProfile>("/api/settings/profile"),
        api.get<{ available: boolean; models: string[] }>("/api/settings/ollama-status").catch(() => ({ data: { available: false, models: [] } })),
      ]);
      setAiKeys(keysRes.data);
      setActiveProvider(keysRes.data.active_provider);
      setOllamaStatus(ollamaRes.data);
      setPlatforms(platRes.data);
      setProfile(profRes.data);
      setProfileInput({
        name: profRes.data.name ?? "",
        email: profRes.data.email ?? "",
        phone: profRes.data.phone ?? "",
        linkedin_url: profRes.data.linkedin_url ?? "",
      });
    } catch {/* ignore */}
    setLoading(false);
  }

  function showFeedback(section: string, msg: string, ok: boolean) {
    setFeedback({ section, msg, ok });
    setTimeout(() => setFeedback(null), 3500);
  }

  async function saveAiKeys() {
    setSavingSection("ai");
    try {
      await api.put("/api/settings/ai-keys", { ...keyInputs, active_provider: activeProvider });
      showFeedback("ai", "Chaves salvas com sucesso.", true);
      setKeyInputs({});
      loadAll();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      showFeedback("ai", err.response?.data?.detail ?? "Falha ao salvar chaves.", false);
    } finally {
      setSavingSection(null);
    }
  }

  async function savePlatformCreds(platform: string) {
    const creds = platInputs[platform];
    if (!creds?.email || !creds?.password) return;
    setSavingSection(platform);
    try {
      await api.put(`/api/settings/platforms/${platform}`, creds);
      showFeedback(platform, `Credenciais salvas para ${platform}.`, true);
      setPlatInputs((p) => ({ ...p, [platform]: { email: "", password: "" } }));
      loadAll();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      showFeedback(platform, err.response?.data?.detail ?? "Falha ao salvar.", false);
    } finally {
      setSavingSection(null);
    }
  }

  async function deletePlatformCreds(platform: string) {
    if (!confirm(`Remover credenciais salvas para ${platform}?`)) return;
    try {
      await api.delete(`/api/settings/platforms/${platform}`);
      loadAll();
    } catch {/* ignore */}
  }

  async function saveProfile() {
    setSavingSection("profile");
    try {
      await api.put("/api/settings/profile", profileInput);
      showFeedback("profile", "Perfil salvo.", true);
    } catch {
      showFeedback("profile", "Falha ao salvar perfil.", false);
    } finally {
      setSavingSection(null);
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-16 gap-2 text-taupe">
      <Loader2 className="w-5 h-5 animate-spin text-coral" />
      <span className="text-sm">Carregando configurações…</span>
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto space-y-3">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Configurações</h1>
        <p className="text-sm text-taupe mt-1">
          Configure providers de IA, credenciais de plataformas e seu perfil.
        </p>
      </div>

      {/* ── AI Keys ─────────────────────────────────────────────────────── */}
      <SettingsSection
        title="Providers de IA"
        icon={<KeyRound className="w-4 h-4" />}
        expanded={expanded.ai}
        onToggle={() => setExpanded((p) => ({ ...p, ai: !p.ai }))}
      >
        <p className="text-sm text-taupe mb-4">
          Adicione sua chave de API de um ou mais providers. Selecione qual usar para análise de currículo.
        </p>

        {/* Seletor de provider ativo */}
        <div className="mb-5">
          <label className="block text-xs font-medium text-taupe-500 uppercase tracking-wide mb-2">Provider ativo</label>
          <div className="flex flex-wrap gap-2">
            {PROVIDERS.map((p) => (
              <button
                key={p.id}
                onClick={() => setActiveProvider(p.id)}
                className={clsx(
                  "px-3 py-1.5 rounded-full border text-sm font-medium transition-all duration-150 flex items-center gap-1.5",
                  activeProvider === p.id
                    ? "border-coral bg-coral-50 text-coral shadow-sm"
                    : "border-taupe-200 text-taupe hover:border-taupe-400 hover:text-gray-700"
                )}
              >
                {p.label}
                {p.free && (
                  <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full leading-none">
                    GRÁTIS
                  </span>
                )}
                {activeProvider === p.id && (
                  <span className="text-xs text-coral/60 font-normal">({p.model})</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Pagos */}
        <p className="text-[11px] font-semibold text-taupe uppercase tracking-widest mb-2">Pagos</p>
        <div className="space-y-3 mb-5">
          {PROVIDERS.filter((p) => !p.free).map((p) => (
            <ProviderKeyRow
              key={p.id}
              p={p}
              savedMask={aiKeys[p.id as keyof AIKeys] as string | null}
              value={keyInputs[p.id] ?? ""}
              onChange={(v) => setKeyInputs((prev) => ({ ...prev, [p.id]: v }))}
              show={!!showKey[p.id]}
              onToggleShow={() => setShowKey((prev) => ({ ...prev, [p.id]: !prev[p.id] }))}
            />
          ))}
        </div>

        {/* Gratuitos online */}
        <p className="text-[11px] font-semibold text-taupe uppercase tracking-widest mb-2">Gratuitos (API online)</p>
        <div className="space-y-3 mb-5">
          {PROVIDERS.filter((p) => p.free && p.id !== "ollama").map((p) => (
            <ProviderKeyRow
              key={p.id}
              p={p}
              savedMask={aiKeys[p.id as keyof AIKeys] as string | null}
              value={keyInputs[p.id] ?? ""}
              onChange={(v) => setKeyInputs((prev) => ({ ...prev, [p.id]: v }))}
              show={!!showKey[p.id]}
              onToggleShow={() => setShowKey((prev) => ({ ...prev, [p.id]: !prev[p.id] }))}
            />
          ))}
        </div>

        {/* Ollama local */}
        <div className={clsx(
          "p-4 border rounded-xl mb-3 transition-colors",
          ollamaStatus.available ? "bg-emerald-50 border-emerald-100" : "bg-taupe-50 border-taupe-100"
        )}>
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className="text-[11px] font-semibold text-gray-600 uppercase tracking-widest">Local — Ollama</span>
            <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">GRÁTIS · SEM INTERNET</span>
            {ollamaStatus.available ? (
              <span className="text-[10px] font-semibold bg-emerald-600 text-white px-1.5 py-0.5 rounded-full flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" /> DETECTADO
              </span>
            ) : (
              <span className="text-[10px] font-semibold bg-taupe-200 text-taupe-500 px-1.5 py-0.5 rounded-full">NÃO DETECTADO</span>
            )}
          </div>
          {ollamaStatus.available && ollamaStatus.models.length > 0 && (
            <p className="text-xs text-emerald-700 mb-2">
              Modelos instalados: <strong>{ollamaStatus.models.join(", ")}</strong>
            </p>
          )}
          <p className="text-xs text-taupe mb-2">
            {ollamaStatus.available
              ? "Ollama detectado. Selecione-o como provider ativo acima e informe o nome do modelo abaixo."
              : <>Instale o{" "}
                <a href="https://ollama.com/download" target="_blank" rel="noopener noreferrer" className="text-coral hover:underline">Ollama</a>{" "}
                e baixe um modelo. Nenhuma chave necessária.</>
            }
          </p>
          {/* Tabela de modelos recomendados */}
          <div className="mb-3 rounded-lg border border-taupe-100 overflow-hidden text-[11px]">
            <div className="grid grid-cols-3 bg-taupe-50 text-taupe-500 font-semibold uppercase tracking-wide px-3 py-1.5">
              <span>Modelo</span>
              <span>Tamanho</span>
              <span>Comando</span>
            </div>
            {[
              { name: "qwen2.5:7b-instruct", size: "~4.7 GB", cmd: "ollama pull qwen2.5:7b-instruct", tag: "⭐ Recomendado" },
              { name: "mistral:7b",           size: "~4.1 GB", cmd: "ollama pull mistral:7b",           tag: "" },
              { name: "llama3.1:8b",          size: "~4.7 GB", cmd: "ollama pull llama3.1:8b",          tag: "" },
              { name: "deepseek-r1:8b",       size: "~5.2 GB", cmd: "ollama pull deepseek-r1:8b",       tag: "Raciocínio" },
            ].map((m) => (
              <div key={m.name} className="grid grid-cols-3 items-center px-3 py-2 border-t border-taupe-100 bg-white hover:bg-sand transition-colors">
                <span className="font-mono text-gray-700 flex items-center gap-1.5">
                  {m.name}
                  {m.tag && <span className="text-[9px] font-semibold bg-coral-50 text-coral border border-coral-100 px-1 py-0.5 rounded">{m.tag}</span>}
                </span>
                <span className="text-taupe">{m.size}</span>
                <code
                  className="text-[10px] font-mono bg-taupe-50 border border-taupe-100 px-1.5 py-0.5 rounded cursor-pointer hover:bg-coral-50 hover:border-coral/30 transition-colors"
                  onClick={() => navigator.clipboard?.writeText(m.cmd)}
                  title="Clique para copiar"
                >
                  {m.cmd}
                </code>
              </div>
            ))}
          </div>
          <ProviderKeyRow
            p={PROVIDERS.find((p) => p.id === "ollama")!}
            savedMask={aiKeys.ollama}
            value={keyInputs["ollama"] ?? ""}
            onChange={(v) => setKeyInputs((prev) => ({ ...prev, ollama: v }))}
            show={!!showKey["ollama"]}
            onToggleShow={() => setShowKey((prev) => ({ ...prev, ollama: !prev["ollama"] }))}
          />
        </div>

        <FeedbackBanner feedback={feedback} section="ai" />

        <button
          onClick={saveAiKeys}
          disabled={savingSection === "ai"}
          className="mt-4 flex items-center gap-2 bg-coral hover:bg-coral-600 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors disabled:opacity-60"
        >
          {savingSection === "ai" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Salvar chaves
        </button>
      </SettingsSection>

      {/* ── Platform Credentials ─────────────────────────────────────────── */}
      <SettingsSection
        title="Credenciais de Plataformas"
        icon={<Globe className="w-4 h-4" />}
        expanded={expanded.platforms}
        onToggle={() => setExpanded((p) => ({ ...p, platforms: !p.platforms }))}
      >
        {/* Aviso burn account */}
        <div className="flex gap-2.5 p-3.5 bg-amber-50 border border-amber-100 rounded-xl text-sm text-amber-800 mb-5">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>
            <strong>Use uma "burn account" dedicada.</strong> Crie uma conta separada em cada plataforma
            exclusivamente para automação. O login automatizado pode violar os Termos de Serviço e
            resultar em banimento. Nunca use sua conta principal.
          </div>
        </div>

        <div className="space-y-4">
          {PLATFORMS.map((plat) => {
            const status = platforms[plat.id];
            const inp = platInputs[plat.id] ?? { email: "", password: "" };
            const isConnected = status?.email || status?.has_password;

            return (
              <div key={plat.id} className="border border-taupe-100 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-base">{plat.icon}</span>
                    <span className="font-medium text-sm text-gray-900">{plat.label}</span>
                    {isConnected ? (
                      <span className="flex items-center gap-1 text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full">
                        <Shield className="w-3 h-3" /> Salvo
                      </span>
                    ) : (
                      <span className="text-[11px] text-taupe bg-taupe-50 border border-taupe-100 px-2 py-0.5 rounded-full">
                        Não configurado
                      </span>
                    )}
                  </div>
                  {isConnected && (
                    <button
                      onClick={() => deletePlatformCreds(plat.id)}
                      className="text-xs text-red-400 hover:text-red-600 transition-colors"
                    >
                      Remover
                    </button>
                  )}
                </div>

                {status?.email && (
                  <p className="text-xs text-taupe mb-3">Email: {status.email}</p>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="email"
                    placeholder="Email da burn account"
                    value={inp.email}
                    onChange={(e) => setPlatInputs((p) => ({ ...p, [plat.id]: { ...inp, email: e.target.value } }))}
                    className="border border-taupe-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-coral/30 focus:border-coral bg-white transition-colors"
                  />
                  <div className="relative">
                    <input
                      type={showPass[plat.id] ? "text" : "password"}
                      placeholder="Senha"
                      value={inp.password}
                      onChange={(e) => setPlatInputs((p) => ({ ...p, [plat.id]: { ...inp, password: e.target.value } }))}
                      className="w-full border border-taupe-200 rounded-xl px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-coral/30 focus:border-coral bg-white transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass((p) => ({ ...p, [plat.id]: !p[plat.id] }))}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-taupe-300 hover:text-taupe transition-colors"
                    >
                      {showPass[plat.id] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <FeedbackBanner feedback={feedback} section={plat.id} />

                <button
                  onClick={() => savePlatformCreds(plat.id)}
                  disabled={!inp.email || !inp.password || savingSection === plat.id}
                  className="mt-2.5 flex items-center gap-1.5 text-xs bg-coral hover:bg-coral-600 text-white font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                >
                  {savingSection === plat.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                  Salvar
                </button>
              </div>
            );
          })}
        </div>
      </SettingsSection>

      {/* ── User Profile ─────────────────────────────────────────────────── */}
      <SettingsSection
        title="Perfil de Candidatura"
        icon={<User className="w-4 h-4" />}
        expanded={expanded.profile}
        onToggle={() => setExpanded((p) => ({ ...p, profile: !p.profile }))}
      >
        <p className="text-sm text-taupe mb-4">
          Usado para preencher automaticamente formulários de candidatura quando o agente aplicar por você.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {[
            { key: "name", label: "Nome completo", type: "text", placeholder: "João Silva" },
            { key: "email", label: "E-mail", type: "email", placeholder: "joao@email.com" },
            { key: "phone", label: "Telefone", type: "tel", placeholder: "+55 11 99999-9999" },
            { key: "linkedin_url", label: "LinkedIn URL", type: "url", placeholder: "https://linkedin.com/in/joaosilva" },
          ].map(({ key, label, type, placeholder }) => (
            <div key={key}>
              <label className="block text-xs font-medium text-taupe-500 mb-1">{label}</label>
              <input
                type={type}
                value={profileInput[key as keyof typeof profileInput]}
                onChange={(e) => setProfileInput((p) => ({ ...p, [key]: e.target.value }))}
                placeholder={placeholder}
                className="w-full border border-taupe-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-coral/30 focus:border-coral bg-white transition-colors"
              />
            </div>
          ))}
        </div>

        <FeedbackBanner feedback={feedback} section="profile" />

        <button
          onClick={saveProfile}
          disabled={savingSection === "profile"}
          className="mt-4 flex items-center gap-2 bg-coral hover:bg-coral-600 text-white text-sm font-medium px-4 py-2 rounded-xl transition-colors disabled:opacity-60"
        >
          {savingSection === "profile" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Salvar perfil
        </button>
      </SettingsSection>
    </div>
  );
}

// ── Sub-componentes ────────────────────────────────────────────────────────────

function SettingsSection({
  title, icon, expanded, onToggle, children,
}: {
  title: string;
  icon: React.ReactNode;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-taupe-100 rounded-2xl overflow-hidden shadow-sm">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-sand transition-colors"
      >
        <div className="flex items-center gap-2.5 font-medium text-gray-900 text-sm">
          <span className="text-taupe">{icon}</span>
          {title}
        </div>
        {expanded
          ? <ChevronDown className="w-4 h-4 text-taupe-300" />
          : <ChevronRight className="w-4 h-4 text-taupe-300" />}
      </button>
      {expanded && (
        <div className="px-5 pb-5 border-t border-taupe-100">
          <div className="pt-4">{children}</div>
        </div>
      )}
    </div>
  );
}

function ProviderKeyRow({
  p, savedMask, value, onChange, show, onToggleShow,
}: {
  p: { id: string; label: string; model: string; placeholder: string; docsUrl: string; color: string; free: boolean; description: string };
  savedMask: string | null;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggleShow: () => void;
}) {
  return (
    <div className="flex items-start gap-4">
      <div className="flex-1 min-w-0">
        {/* Label row: nome + descrição + badge de chave salva */}
        <div className="flex items-center gap-2 mb-1.5 min-w-0">
          <span className={clsx("text-xs font-semibold flex-shrink-0", p.color)}>{p.label}</span>
          <span className="text-taupe text-[11px] truncate">{p.description}</span>
          {savedMask && (
            <span className="flex-shrink-0 text-[10px] font-mono text-taupe-400 bg-taupe-50 border border-taupe-100 px-1.5 py-0.5 rounded-md truncate max-w-[140px]">
              {savedMask}
            </span>
          )}
        </div>
        <div className="relative">
          <input
            type={p.id === "ollama" ? "text" : (show ? "text" : "password")}
            placeholder={p.id === "ollama" ? `Modelo: ${p.placeholder}` : `Nova chave: ${p.placeholder}`}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full border border-taupe-200 rounded-xl px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-coral/30 focus:border-coral font-mono bg-white transition-colors"
          />
          <button
            type="button"
            onClick={onToggleShow}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-taupe-300 hover:text-taupe transition-colors"
          >
            {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </div>
      <a
        href={p.docsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-coral hover:underline whitespace-nowrap flex-shrink-0 mt-7 transition-colors"
      >
        Obter chave →
      </a>
    </div>
  );
}

function FeedbackBanner({
  feedback, section,
}: {
  feedback: { section: string; msg: string; ok: boolean } | null;
  section: string;
}) {
  if (!feedback || feedback.section !== section) return null;
  return (
    <div className={clsx(
      "flex items-center gap-2 text-sm rounded-xl px-3 py-2.5 mt-3",
      feedback.ok
        ? "bg-emerald-50 text-emerald-700 border border-emerald-100"
        : "bg-red-50 text-red-700 border border-red-100"
    )}>
      {feedback.ok
        ? <CheckCircle className="w-4 h-4 flex-shrink-0" />
        : <AlertTriangle className="w-4 h-4 flex-shrink-0" />}
      {feedback.msg}
    </div>
  );
}
