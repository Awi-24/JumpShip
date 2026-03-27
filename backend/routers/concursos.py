"""Router for Brazilian public concursos (civil service competitions)."""
from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional

from backend.services.concursos_scraper import search_concursos

router = APIRouter(prefix="/api/concursos", tags=["concursos"])


# ── Pydantic schemas ────────────────────────────────────────────────────────


class ConcursosSearchRequest(BaseModel):
    estado: str = ""
    nivel: str = ""
    area: str = ""
    salario_minimo: float = 0
    apenas_abertos: bool = True
    banca: str = ""
    orgao: str = ""
    results_wanted: int = 30


# ── Endpoints ───────────────────────────────────────────────────────────────


@router.post("/search")
def search(req: ConcursosSearchRequest):
    """Search for concursos públicos."""
    results = search_concursos(
        estado=req.estado,
        nivel=req.nivel,
        area=req.area,
        salario_minimo=req.salario_minimo,
        apenas_abertos=req.apenas_abertos,
        banca=req.banca,
        orgao=req.orgao,
        results_wanted=req.results_wanted,
    )
    return {"concursos": results, "total": len(results)}


@router.get("/estados")
def list_estados():
    """Return list of Brazilian states for the filter dropdown."""
    return {
        "estados": [
            {"code": "AC", "name": "Acre"},
            {"code": "AL", "name": "Alagoas"},
            {"code": "AP", "name": "Amapá"},
            {"code": "AM", "name": "Amazonas"},
            {"code": "BA", "name": "Bahia"},
            {"code": "CE", "name": "Ceará"},
            {"code": "DF", "name": "Distrito Federal"},
            {"code": "ES", "name": "Espírito Santo"},
            {"code": "GO", "name": "Goiás"},
            {"code": "MA", "name": "Maranhão"},
            {"code": "MT", "name": "Mato Grosso"},
            {"code": "MS", "name": "Mato Grosso do Sul"},
            {"code": "MG", "name": "Minas Gerais"},
            {"code": "PA", "name": "Pará"},
            {"code": "PB", "name": "Paraíba"},
            {"code": "PR", "name": "Paraná"},
            {"code": "PE", "name": "Pernambuco"},
            {"code": "PI", "name": "Piauí"},
            {"code": "RJ", "name": "Rio de Janeiro"},
            {"code": "RN", "name": "Rio Grande do Norte"},
            {"code": "RS", "name": "Rio Grande do Sul"},
            {"code": "RO", "name": "Rondônia"},
            {"code": "RR", "name": "Roraima"},
            {"code": "SC", "name": "Santa Catarina"},
            {"code": "SP", "name": "São Paulo"},
            {"code": "SE", "name": "Sergipe"},
            {"code": "TO", "name": "Tocantins"},
        ]
    }


@router.get("/areas")
def list_areas():
    """Return list of concurso areas for the filter dropdown."""
    return {
        "areas": [
            "Administração",
            "Agronomia",
            "Comunicação",
            "Contabilidade",
            "Direito",
            "Educação",
            "Engenharia",
            "Informática / TI",
            "Meio Ambiente",
            "Policial / Segurança",
            "Saúde",
        ]
    }


@router.get("/niveis")
def list_niveis():
    """Return list of concurso education levels for the filter dropdown."""
    return {"niveis": ["Fundamental", "Médio", "Superior"]}


@router.get("/bancas")
def list_bancas():
    """Return list of concurso exam boards for the filter dropdown."""
    return {
        "bancas": [
            "Cebraspe",
            "FCC",
            "FGV",
            "VUNESP",
            "IBFC",
            "IDECAN",
            "Instituto AOCP",
            "IADES",
            "Quadrix",
        ]
    }
