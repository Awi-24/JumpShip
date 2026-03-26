"use client";

import { useEffect, useCallback, useMemo } from "react";
import { concursosApi, Concurso } from "@/lib/api";
import { usePersistedState } from "@/lib/usePersistedState";
import {
  Search,
  Filter,
  MapPin,
  Calendar,
  DollarSign,
  Users,
  ExternalLink,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  RefreshCw,
} from "lucide-react";
import clsx from "clsx";

const NIVEIS = [
  { label: "Todos", value: "" },
  { label: "Fundamental", value: "fundamental" },
  { label: "Médio", value: "medio" },
  { label: "Superior", value: "superior" },
];

// All 27 Brazilian states
const ESTADOS = [
  "Acre", "Alagoas", "Amapá", "Amazonas", "Bahia", "Ceará", "Distrito Federal",
  "Espírito Santo", "Goiás", "Maranhão", "Mato Grosso", "Mato Grosso do Sul",
  "Minas Gerais", "Pará", "Paraíba", "Paraná", "Pernambuco", "Piauí",
  "Rio de Janeiro", "Rio Grande do Norte", "Rio Grande do Sul", "Rondônia",
  "Roraima", "Santa Catarina", "São Paulo", "Sergipe", "Tocantins",
];

const formatCurrency = (value: number | undefined) => {
  if (!value) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
};

const getStatusBadgeColor = (status: string) => {
  switch (status) {
    case "Aberto":
      return "bg-green-100 text-green-800 border-green-200";
    case "Previsto":
      return "bg-yellow-100 text-yellow-800 border-yellow-200";
    case "Encerrado":
      return "bg-red-100 text-red-800 border-red-200";
    default:
      return "bg-gray-100 text-gray-800 border-gray-200";
  }
};

export default function ConcursosPage() {
  const [searchTerm, setSearchTerm] = usePersistedState("concursos_search_term", "");
  const [estado, setEstado] = usePersistedState("concursos_estado", "");
  const [nivel, setNivel] = usePersistedState("concursos_nivel", "");
  const [area, setArea] = usePersistedState("concursos_area", "");
  const [salarioMinimo, setSalarioMinimo] = usePersistedState<number | undefined>("concursos_salario_minimo", undefined);
  const [apenasAbertos, setApenasAbertos] = usePersistedState("concursos_apenas_abertos", true);
  const [banca, setBanca] = usePersistedState("concursos_banca", "");
  const [orgao, setOrgao] = usePersistedState("concursos_orgao", "");
  const [showFilters, setShowFilters] = usePersistedState("concursos_show_filters", false);
  const [concursos, setConcursos] = usePersistedState<Concurso[]>("concursos_results", []);
  const [loading, setLoading] = usePersistedState("concursos_loading", false);
  const [error, setError] = usePersistedState<string | null>("concursos_error", null);
  const [searched, setSearched] = usePersistedState("concursos_searched", false);

  const [areas, setAreas] = usePersistedState<string[]>("concursos_areas_list", []);
  const [bancas, setBancas] = usePersistedState<string[]>("concursos_bancas_list", []);
  const [loadingOptions, setLoadingOptions] = usePersistedState("concursos_loading_options", false);

  // Load filter options on mount
  useEffect(() => {
    const loadOptions = async () => {
      try {
        setLoadingOptions(true);
        const [areasRes, bancasRes] = await Promise.all([
          concursosApi.getAreas(),
          concursosApi.getBancas(),
        ]);
        setAreas(areasRes.data);
        setBancas(bancasRes.data);
      } catch {
        // Silently fail for options loading
      } finally {
        setLoadingOptions(false);
      }
    };
    loadOptions();
  }, []);

  const handleSearch = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!searchTerm.trim()) return;

      setLoading(true);
      setError(null);
      setConcursos([]);
      setSearched(true);

      try {
        const { data } = await concursosApi.search({
          estado: estado || undefined,
          nivel: nivel || undefined,
          area: area || undefined,
          salario_minimo: salarioMinimo,
          apenas_abertos: apenasAbertos,
          banca: banca || undefined,
          orgao: orgao || undefined,
        });
        setConcursos(data.concursos);
        if (data.concursos.length === 0) {
          setError("Nenhum concurso encontrado. Tente ajustar os filtros.");
        }
      } catch (e: unknown) {
        const err = e as { response?: { data?: { detail?: string } }; message?: string };
        setError(err.response?.data?.detail ?? err.message ?? "Busca falhou. Verifique se o backend está rodando.");
      } finally {
        setLoading(false);
      }
    },
    [searchTerm, estado, nivel, area, salarioMinimo, apenasAbertos, banca, orgao, setConcursos, setError, setLoading, setSearched]
  );

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-5rem)]">
      {/* Search Bar */}
      <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-taupe-400" />
          <input
            type="text"
            placeholder="Cargo, área, palavras-chave…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 bg-white border border-taupe-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-coral focus:border-transparent shadow-sm"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !searchTerm.trim()}
          className="flex items-center gap-2 bg-coral hover:bg-coral-600 disabled:opacity-60 text-white font-medium px-5 py-2.5 rounded-xl transition-colors text-sm shadow-sm"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          Buscar
        </button>
        <button
          type="button"
          onClick={() => setShowFilters(!showFilters)}
          className={clsx(
            "flex items-center gap-2 border px-4 py-2.5 rounded-xl text-sm font-medium transition-colors shadow-sm",
            showFilters
              ? "border-coral bg-coral-50 text-coral"
              : "border-taupe-200 bg-white text-gray-600 hover:border-taupe-400"
          )}
        >
          <Filter className="w-4 h-4" />
          Filtros
          {showFilters ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
      </form>

      {/* Filters Panel */}
      {showFilters && (
        <div className="bg-white border border-taupe-100 rounded-xl p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 text-sm shadow-sm">
          {/* Estado */}
          <div>
            <label className="block text-xs font-semibold text-taupe-500 mb-1 uppercase tracking-wide">
              Estado/Região
            </label>
            <select
              value={estado}
              onChange={(e) => setEstado(e.target.value)}
              className="w-full border border-taupe-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-coral bg-white"
            >
              <option value="">Todos</option>
              {ESTADOS.map((e) => (
                <option key={e} value={e}>{e}</option>
              ))}
            </select>
          </div>

          {/* Nível */}
          <div>
            <label className="block text-xs font-semibold text-taupe-500 mb-1 uppercase tracking-wide">Nível</label>
            <select
              value={nivel}
              onChange={(e) => setNivel(e.target.value)}
              className="w-full border border-taupe-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-coral bg-white"
            >
              {NIVEIS.map((n) => (
                <option key={n.value} value={n.value}>{n.label}</option>
              ))}
            </select>
          </div>

          {/* Área */}
          <div>
            <label className="block text-xs font-semibold text-taupe-500 mb-1 uppercase tracking-wide">Área</label>
            <select
              value={area}
              onChange={(e) => setArea(e.target.value)}
              disabled={loadingOptions}
              className="w-full border border-taupe-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-coral bg-white disabled:opacity-60"
            >
              <option value="">Todas</option>
              {areas.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>

          {/* Banca */}
          <div>
            <label className="block text-xs font-semibold text-taupe-500 mb-1 uppercase tracking-wide">Banca</label>
            <select
              value={banca}
              onChange={(e) => setBanca(e.target.value)}
              disabled={loadingOptions}
              className="w-full border border-taupe-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-coral bg-white disabled:opacity-60"
            >
              <option value="">Todas</option>
              {bancas.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>

          {/* Salário Mínimo */}
          <div>
            <label className="block text-xs font-semibold text-taupe-500 mb-1 uppercase tracking-wide">
              Salário Mín. (R$)
            </label>
            <input
              type="number"
              placeholder="0"
              value={salarioMinimo ?? ""}
              onChange={(e) => setSalarioMinimo(e.target.value ? Number(e.target.value) : undefined)}
              className="w-full border border-taupe-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-coral bg-white"
            />
          </div>

          {/* Órgão */}
          <div>
            <label className="block text-xs font-semibold text-taupe-500 mb-1 uppercase tracking-wide">Órgão</label>
            <input
              type="text"
              placeholder="Buscar órgão…"
              value={orgao}
              onChange={(e) => setOrgao(e.target.value)}
              className="w-full border border-taupe-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-coral bg-white"
            />
          </div>

          {/* Status Toggle */}
          <div className="col-span-2 sm:col-span-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={apenasAbertos}
                onChange={(e) => setApenasAbertos(e.target.checked)}
                className="w-4 h-4 accent-coral"
              />
              <span className="text-sm text-gray-700">Apenas abertos</span>
            </label>
          </div>
        </div>
      )}

      {/* Results area */}
      <div className="flex flex-col gap-2.5 overflow-y-auto flex-1">
        {loading && (
          <div className="flex items-center justify-center gap-3 py-16 text-taupe-500">
            <Loader2 className="w-5 h-5 animate-spin text-coral" />
            <span className="text-sm">Buscando concursos…</span>
          </div>
        )}

        {error && !loading && (
          <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {!loading && !error && !searched && (
          <div className="flex flex-col items-center justify-center py-20 text-center text-taupe-400 gap-4">
            <div className="w-20 h-20 rounded-2xl bg-white border border-taupe-100 flex items-center justify-center shadow-sm">
              <Users className="w-9 h-9 text-coral opacity-60" />
            </div>
            <div>
              <p className="font-semibold text-gray-700">Comece sua busca</p>
              <p className="text-sm mt-1 text-taupe-500">Digite um cargo ou área acima</p>
            </div>
          </div>
        )}

        {!loading && concursos.length > 0 && (
          <div className="flex items-center justify-between text-xs text-taupe-500 px-1 mb-1">
            <span className="font-medium">{concursos.length} concurso(s) encontrado(s)</span>
            <button
              onClick={() => handleSearch()}
              className="flex items-center gap-1 hover:text-coral transition-colors"
            >
              <RefreshCw className="w-3 h-3" /> Atualizar
            </button>
          </div>
        )}

        {concursos.map((concurso, idx) => (
          <a
            key={concurso.id ?? idx}
            href={concurso.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group bg-white border border-taupe-100 rounded-xl p-4 hover:shadow-md hover:border-coral transition-all hover:-translate-y-0.5"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-gray-900 group-hover:text-coral transition-colors text-sm line-clamp-2">
                  {concurso.titulo}
                </h3>
                <p className="text-xs text-taupe-500 mt-0.5">{concurso.orgao}</p>
              </div>
              <span
                className={clsx(
                  "text-xs font-medium px-2.5 py-1 rounded-full border whitespace-nowrap flex-shrink-0",
                  getStatusBadgeColor(concurso.status)
                )}
              >
                {concurso.status}
              </span>
            </div>

            {/* Details Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs mb-3">
              {/* State */}
              <div className="flex items-center gap-1.5 text-taupe-600">
                <MapPin className="w-3.5 h-3.5 flex-shrink-0 text-coral opacity-60" />
                <span>{concurso.estado}</span>
              </div>

              {/* Vacancies */}
              <div className="flex items-center gap-1.5 text-taupe-600">
                <Users className="w-3.5 h-3.5 flex-shrink-0 text-coral opacity-60" />
                <span>{concurso.vagas} vaga{concurso.vagas !== 1 ? "s" : ""}</span>
              </div>

              {/* Salary Range */}
              <div className="flex items-center gap-1.5 text-taupe-600">
                <DollarSign className="w-3.5 h-3.5 flex-shrink-0 text-coral opacity-60" />
                <span>{formatCurrency(concurso.salario_minimo)}</span>
              </div>

              {/* Banca */}
              <div className="text-taupe-600 truncate" title={concurso.banca}>
                <span className="text-taupe-400">Banca:</span> {concurso.banca}
              </div>
            </div>

            {/* Dates */}
            {(concurso.data_inscricao_inicio || concurso.data_inscricao_fim) && (
              <div className="flex items-center gap-1.5 text-xs text-taupe-600 mb-3">
                <Calendar className="w-3.5 h-3.5 flex-shrink-0 text-coral opacity-60" />
                <span>
                  {concurso.data_inscricao_inicio && (
                    <>
                      Inscrições: {new Date(concurso.data_inscricao_inicio).toLocaleDateString("pt-BR")}
                      {concurso.data_inscricao_fim && (
                        <> até {new Date(concurso.data_inscricao_fim).toLocaleDateString("pt-BR")}</>
                      )}
                    </>
                  )}
                </span>
              </div>
            )}

            {/* Link */}
            <div className="flex items-center justify-end gap-1 text-coral text-xs font-medium group-hover:gap-2 transition-all">
              Ver detalhes
              <ExternalLink className="w-3 h-3" />
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
