import React, { useState, useMemo, useEffect } from 'react';

// ============================================================
// CONFIG — cole aqui as URLs de CSV publicadas da planilha
// ============================================================
const CONFIG_DEFAULT = {
  // Aba "Convênios" publicada como CSV (já conectada — não pede mais toda vez)
  convenios: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTlW4eVLGLn5nDrfmRr6hrE-0fpH7UlykxrZn2TK5sf_wPPBgWuVwXY4Q-Dx_rxmg/pub?gid=1368551752&single=true&output=csv',
  // Opcional: total da clínica (particular+convênio) para a lente "Geral" e "Sem Convênio".
  // Se vazio, o dashboard usa os números-base de junho embutidos abaixo.
  totalClinica: '',
};

// Base de junho (fallback quando não há CSV de total da clínica)
// Total terapia: 390 sessões, receita R$77.350 (conv já a R$170), repasse R$42.955
const BASE_JUN = {
  totalSessoes: 390, totalReceita: 77350, totalRepasse: 42955,
};
const BOLETO = 6.88;
const CUSTO_FIXO = 29012;

const OPERADORAS = ['Cassi', 'Bradesco', 'Vale', 'Amil', 'Sul América', 'Porto Seguro', 'Outros'];
const TIPOS = ['ABA', 'TO', 'Fono', 'Fisio', 'Psico', 'Pedagogia', 'Neuropsi', 'Outros'];
const COR_OP = { Cassi: '#2A5A7A', Bradesco: '#A03328', Vale: '#5B8C6E', Amil: '#8A5A2B', 'Sul América': '#9A6BA8', 'Porto Seguro': '#4A8A8A', Outros: '#8B8275' };

const BRL = (v) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const NUM = (v) => (v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
const PCT = (v) => `${(v || 0).toFixed(0)}%`;

// Parser de número brasileiro (1.234,56 -> 1234.56)
function parseBR(s) {
  if (s == null) return 0;
  if (typeof s === 'number') return s;
  let t = String(s).replace(/[R$\s]/g, '').trim();
  if (!t) return 0;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(t);
  return isNaN(n) ? 0 : n;
}

// Parser de CSV simples (lida com aspas)
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else {
      if (c === '"') q = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { }
      else field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Interpreta a aba Convênios: linhas a partir da 5 (índice 4), colunas A-G
function parseConvenios(rows) {
  const out = [];
  for (let i = 4; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const operadora = (r[1] || '').trim();
    const sessoes = parseBR(r[4]);
    if (!operadora || !sessoes) continue; // linha vazia
    out.push({
      mes: (r[0] || '').trim(),
      operadora,
      liminar: (r[2] || '').trim().toLowerCase().startsWith('s'),
      tipo: (r[3] || '').trim(),
      sessoes,
      receita: parseBR(r[5]),
      repasse: parseBR(r[6]),
    });
  }
  return out;
}

function margem(l) { return l.receita - l.repasse - l.sessoes * BOLETO; }
function agrega(lista) {
  return lista.reduce((a, l) => ({
    sessoes: a.sessoes + l.sessoes, receita: a.receita + l.receita,
    repasse: a.repasse + l.repasse, mc: a.mc + margem(l),
  }), { sessoes: 0, receita: 0, repasse: 0, mc: 0 });
}

function Chip({ ativo, cor, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      border: ativo ? `1.5px solid ${cor}` : '1px solid #D8D2C4',
      background: ativo ? cor : '#FFF', color: ativo ? '#fff' : '#6A6A6A',
      borderRadius: 16, padding: '5px 13px', cursor: 'pointer', fontSize: 12.5, fontWeight: 600,
    }}>{children}</button>
  );
}
function Card({ label, valor, sub, destaque, cor }) {
  return (
    <div style={{ background: destaque ? (cor || '#1A3D2E') : '#FFF', border: `1px solid ${destaque ? (cor || '#1A3D2E') : '#E5E0D5'}`, borderRadius: 10, padding: '18px 20px' }}>
      <div style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600, color: destaque ? 'rgba(255,255,255,0.8)' : '#9A8B6F', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, fontFamily: 'Georgia, serif', color: destaque ? '#fff' : '#1A1A1A', lineHeight: 1 }}>{valor}</div>
      {sub && <div style={{ fontSize: 12, color: destaque ? 'rgba(255,255,255,0.75)' : '#9A9488', marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

const CORES_SEG = {
  Geral: { main: '#1A3D2E', label: 'Clínica completa' },
  'Sem Convênio': { main: '#2A5A7A', label: 'Só particular' },
  'Convênio': { main: '#8A5A2B', label: 'Só convênio' },
};

export default function App() {
  const [config, setConfig] = useState(CONFIG_DEFAULT);
  const [tmpUrl, setTmpUrl] = useState('');
  const [lancamentos, setLancamentos] = useState([]);
  const [status, setStatus] = useState('sem-url'); // sem-url | carregando | ok | erro
  const [erro, setErro] = useState('');
  const [seg, setSeg] = useState('Geral');
  const [fOperadora, setFOperadora] = useState('Todas');
  const [fLiminar, setFLiminar] = useState('Todos');
  const [fTipo, setFTipo] = useState('Todos');

  async function carregar(url) {
    if (!url) { setStatus('sem-url'); return; }
    setStatus('carregando'); setErro('');
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const txt = await res.text();
      const dados = parseConvenios(parseCSV(txt));
      setLancamentos(dados);
      setStatus('ok');
    } catch (e) {
      setErro(e.name === 'AbortError' ? 'Tempo esgotado ao conectar. Verifique se a aba está publicada como CSV.' : e.message);
      setStatus('erro');
    }
  }

  useEffect(() => { if (config.convenios) carregar(config.convenios); }, [config.convenios]);

  const conv = useMemo(() => agrega(lancamentos), [lancamentos]);
  // Geral e Particular derivados (usa base de junho para o total da clínica)
  const totalClinica = { sessoes: BASE_JUN.totalSessoes, receita: BASE_JUN.totalReceita, repasse: BASE_JUN.totalRepasse };
  totalClinica.mc = totalClinica.receita - totalClinica.repasse - totalClinica.sessoes * BOLETO;
  const particular = {
    sessoes: Math.max(0, totalClinica.sessoes - conv.sessoes),
    receita: Math.max(0, totalClinica.receita - conv.receita),
    repasse: Math.max(0, totalClinica.repasse - conv.repasse),
  };
  particular.mc = particular.receita - particular.repasse - particular.sessoes * BOLETO;

  // Filtro do convênio (subfiltros)
  const convFiltrado = useMemo(() => lancamentos.filter((l) =>
    (fOperadora === 'Todas' || l.operadora === fOperadora) &&
    (fLiminar === 'Todos' || (fLiminar === 'Liminar' ? l.liminar : !l.liminar)) &&
    (fTipo === 'Todos' || l.tipo === fTipo)
  ), [lancamentos, fOperadora, fLiminar, fTipo]);
  const convFilt = useMemo(() => agrega(convFiltrado), [convFiltrado]);

  const dadosSeg = seg === 'Geral' ? totalClinica : seg === 'Convênio' ? convFilt : particular;
  const ticket = dadosSeg.sessoes ? dadosSeg.receita / dadosSeg.sessoes : 0;
  const mcPct = dadosSeg.receita ? (dadosSeg.mc / dadosSeg.receita) * 100 : 0;
  const repSessao = dadosSeg.sessoes ? dadosSeg.repasse / dadosSeg.sessoes : 0;
  const cor = CORES_SEG[seg].main;

  // Concentração
  const porOperadora = useMemo(() => {
    const m = {};
    lancamentos.forEach((l) => { m[l.operadora] = (m[l.operadora] || 0) + l.receita; });
    const tot = Object.values(m).reduce((a, b) => a + b, 0) || 1;
    return Object.entries(m).map(([op, rec]) => ({ op, rec, pct: (rec / tot) * 100 })).sort((a, b) => b.rec - a.rec);
  }, [lancamentos]);
  const maiorOp = porOperadora[0];
  const liminarReceita = lancamentos.filter((l) => l.liminar).reduce((a, l) => a + l.receita, 0);
  const liminarPct = conv.receita ? (liminarReceita / conv.receita) * 100 : 0;

  // ---- TELA DE CONFIG ----
  if (status === 'sem-url' || status === 'erro') {
    return (
      <div style={{ minHeight: '100vh', background: '#FBFAF6', fontFamily: 'system-ui, sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ background: '#FFF', border: '1px solid #E5E0D5', borderRadius: 12, padding: 32, maxWidth: 560, width: '100%' }}>
          <div style={{ fontSize: 11, letterSpacing: '0.15em', color: '#9A8B6F', textTransform: 'uppercase', fontWeight: 600, marginBottom: 8 }}>Clínica Borges · Gestão de convênios</div>
          <h1 style={{ margin: 0, fontSize: 24, fontFamily: 'Georgia, serif', color: '#1A3D2E' }}>Conectar à planilha</h1>
          <p style={{ fontSize: 14, color: '#6A6A6A', lineHeight: 1.6, marginTop: 12 }}>
            Cole a URL de CSV publicada da aba <strong>"Convênios"</strong>. No Google Sheets: Arquivo → Compartilhar → Publicar na web → escolha a aba "Convênios" e o formato <strong>.csv</strong>.
          </p>
          {status === 'erro' && (
            <div style={{ background: '#F5E3DF', color: '#A03328', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 12 }}>⚠️ {erro}</div>
          )}
          <input value={tmpUrl} onChange={(e) => setTmpUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/e/.../pub?gid=...&single=true&output=csv"
            style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #D8D2C4', borderRadius: 8, padding: '10px 12px', fontSize: 13, marginBottom: 12 }} />
          <button onClick={() => setConfig({ ...config, convenios: tmpUrl })} style={{ background: '#1A3D2E', color: '#fff', border: 'none', borderRadius: 8, padding: '11px 20px', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>Conectar</button>
        </div>
      </div>
    );
  }
  if (status === 'carregando') {
    return <div style={{ minHeight: '100vh', background: '#FBFAF6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Georgia, serif', fontSize: 20, color: '#1A3D2E' }}>Carregando convênios…</div>;
  }

  return (
    <div style={{ minHeight: '100vh', background: '#FBFAF6', fontFamily: 'system-ui, sans-serif', color: '#1A1A1A' }}>
      <div style={{ borderBottom: '1px solid #E5E0D5', background: '#FFF' }}>
        <div style={{ maxWidth: 1080, margin: '0 auto', padding: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 11, letterSpacing: '0.15em', color: '#9A8B6F', textTransform: 'uppercase', marginBottom: 6, fontWeight: 600 }}>Clínica Borges · Painel de gestão</div>
              <h1 style={{ margin: 0, fontSize: 28, fontFamily: 'Georgia, serif', fontWeight: 700, color: '#1A3D2E' }}>Convênio × Particular</h1>
              <p style={{ margin: '6px 0 0', fontSize: 14, color: '#6A6A6A' }}>Três lentes da clínica. Em "Convênio", filtre por operadora, liminar e tipo.</p>
            </div>
            <button onClick={() => carregar(config.convenios)} style={{ border: '1px solid #D8D2C4', background: '#FFF', color: '#1A3D2E', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>↻ Atualizar</button>
          </div>
          {/* Seletor de segmento */}
          <div style={{ display: 'flex', gap: 6, marginTop: 20 }}>
            {Object.keys(CORES_SEG).map((s) => (
              <button key={s} onClick={() => setSeg(s)} style={{
                border: seg === s ? `1.5px solid ${CORES_SEG[s].main}` : '1px solid #D8D2C4',
                background: seg === s ? CORES_SEG[s].main : '#FFF', color: seg === s ? '#fff' : '#6A6A6A',
                borderRadius: 8, padding: '8px 18px', cursor: 'pointer', fontSize: 14, fontWeight: 600,
              }}>{s}</button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 18 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: cor, fontFamily: 'Georgia, serif' }}>{seg}</div>
          <div style={{ fontSize: 13, color: '#9A9488' }}>{CORES_SEG[seg].label}</div>
          {seg === 'Convênio' && totalClinica.receita > 0 && (
            <div style={{ fontSize: 13, color: '#8A5A2B', fontWeight: 600, marginLeft: 'auto' }}>{PCT(conv.receita / totalClinica.receita * 100)} da receita da clínica</div>
          )}
        </div>

        {/* SUBFILTROS — só no Convênio */}
        {seg === 'Convênio' && (
          <div style={{ background: '#FFF', border: '1px solid #E5E0D5', borderRadius: 10, padding: 18, marginBottom: 18 }}>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: '#9A8B6F', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Operadora</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <Chip ativo={fOperadora === 'Todas'} cor="#1A3D2E" onClick={() => setFOperadora('Todas')}>Todas</Chip>
                {OPERADORAS.map((op) => <Chip key={op} ativo={fOperadora === op} cor={COR_OP[op]} onClick={() => setFOperadora(op)}>{op}</Chip>)}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 11, color: '#9A8B6F', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Liminar</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {['Todos', 'Liminar', 'Regular'].map((f) => <Chip key={f} ativo={fLiminar === f} cor="#A03328" onClick={() => setFLiminar(f)}>{f}</Chip>)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#9A8B6F', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Tipo de terapia</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <Chip ativo={fTipo === 'Todos'} cor="#5B8C6E" onClick={() => setFTipo('Todos')}>Todos</Chip>
                  {TIPOS.map((t) => <Chip key={t} ativo={fTipo === t} cor="#5B8C6E" onClick={() => setFTipo(t)}>{t}</Chip>)}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }}>
          <Card label="Sessões" valor={NUM(dadosSeg.sessoes)} sub={seg !== 'Geral' && totalClinica.sessoes ? `${PCT(dadosSeg.sessoes / totalClinica.sessoes * 100)} do total` : 'no mês'} destaque cor={cor} />
          <Card label="Receita" valor={BRL(dadosSeg.receita)} sub={`ticket ${BRL(ticket)}`} />
          <Card label="Margem contribuição" valor={BRL(dadosSeg.mc)} sub={`${PCT(mcPct)} da receita`} />
          <Card label="Repasse" valor={BRL(dadosSeg.repasse)} sub={`${BRL(repSessao)}/sessão`} />
        </div>

        {/* CONCENTRAÇÃO — só no Convênio */}
        {seg === 'Convênio' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 20 }}>
            <div style={{ background: '#FFF', border: '1px solid #E5E0D5', borderRadius: 10, padding: 20 }}>
              <div style={{ fontSize: 12, letterSpacing: '0.08em', color: '#9A8B6F', textTransform: 'uppercase', fontWeight: 700, marginBottom: 14 }}>Concentração por operadora</div>
              {porOperadora.length === 0 && <div style={{ fontSize: 13, color: '#9A9488' }}>Sem dados.</div>}
              {porOperadora.map((o) => (
                <div key={o.op} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 3 }}>
                    <span style={{ color: '#4A4A4A', fontWeight: 600 }}>{o.op}</span>
                    <span style={{ color: '#6A6A6A', fontVariantNumeric: 'tabular-nums' }}>{BRL(o.rec)} · {PCT(o.pct)}</span>
                  </div>
                  <div style={{ height: 7, background: '#EFEBE0', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${o.pct}%`, height: '100%', background: COR_OP[o.op] || '#8B8275' }} />
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ background: maiorOp && maiorOp.pct > 60 ? '#F5E3DF' : '#F5F2EA', border: '1px solid #E5E0D5', borderRadius: 10, padding: 20 }}>
                <div style={{ fontSize: 12, letterSpacing: '0.08em', color: '#9A8B6F', textTransform: 'uppercase', fontWeight: 700, marginBottom: 10 }}>Maior dependência</div>
                <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'Georgia, serif', color: maiorOp && maiorOp.pct > 60 ? '#A03328' : '#1A3D2E' }}>{maiorOp ? `${maiorOp.op} · ${PCT(maiorOp.pct)}` : '—'}</div>
                <div style={{ fontSize: 12, color: '#6A6A6A', marginTop: 6, lineHeight: 1.5 }}>{maiorOp && maiorOp.pct > 60 ? '⚠️ Alta concentração numa operadora. Vale diversificar.' : 'Concentração sob controle.'}</div>
              </div>
              <div style={{ background: liminarPct > 25 ? '#F5E3DF' : '#F5F2EA', border: '1px solid #E5E0D5', borderRadius: 10, padding: 20 }}>
                <div style={{ fontSize: 12, letterSpacing: '0.08em', color: '#9A8B6F', textTransform: 'uppercase', fontWeight: 700, marginBottom: 10 }}>Receita por liminar</div>
                <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'Georgia, serif', color: liminarPct > 25 ? '#A03328' : '#1A3D2E' }}>{PCT(liminarPct)}</div>
                <div style={{ fontSize: 12, color: '#6A6A6A', marginTop: 6, lineHeight: 1.5 }}>{liminarPct > 25 ? '⚠️ Parte relevante depende de decisão judicial — menos previsível.' : 'Exposição a liminares baixa.'}</div>
              </div>
            </div>
          </div>
        )}

        {/* TABELA — no Convênio mostra lançamentos; nas outras, comparativo */}
        {seg === 'Convênio' ? (
          <div style={{ background: '#FFF', border: '1px solid #E5E0D5', borderRadius: 10, padding: 24 }}>
            <div style={{ fontSize: 12, letterSpacing: '0.1em', color: '#9A8B6F', textTransform: 'uppercase', fontWeight: 700, marginBottom: 14 }}>Lançamentos</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ color: '#9A9488', fontSize: 11, textTransform: 'uppercase' }}>
                {['Operadora', 'Liminar', 'Tipo', 'Sessões', 'Receita', 'Repasse', 'Margem'].map((h, i) => <th key={h} style={{ textAlign: i < 3 ? 'left' : 'right', padding: '6px 10px', fontWeight: 600 }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {convFiltrado.map((l, i) => (
                  <tr key={i} style={{ borderTop: '1px solid #EEEAE0' }}>
                    <td style={{ padding: '9px 10px', fontWeight: 600, color: COR_OP[l.operadora] || '#1A1A1A' }}>{l.operadora}</td>
                    <td style={{ padding: '9px 10px' }}>{l.liminar ? <span style={{ color: '#A03328', fontWeight: 600 }}>Liminar</span> : <span style={{ color: '#9A9488' }}>Regular</span>}</td>
                    <td style={{ padding: '9px 10px', color: '#6A6A6A' }}>{l.tipo}</td>
                    <td style={{ padding: '9px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{l.sessoes}</td>
                    <td style={{ padding: '9px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{BRL(l.receita)}</td>
                    <td style={{ padding: '9px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#8A5A2B' }}>{BRL(l.repasse)}</td>
                    <td style={{ padding: '9px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: '#1A3D2E' }}>{BRL(margem(l))}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: '2px solid #1A3D2E', fontWeight: 700 }}>
                  <td style={{ padding: '10px', color: '#1A3D2E' }} colSpan={3}>Total</td>
                  <td style={{ padding: '10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{convFilt.sessoes}</td>
                  <td style={{ padding: '10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{BRL(convFilt.receita)}</td>
                  <td style={{ padding: '10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#8A5A2B' }}>{BRL(convFilt.repasse)}</td>
                  <td style={{ padding: '10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#1A3D2E' }}>{BRL(convFilt.mc)}</td>
                </tr>
              </tbody>
            </table>
            {convFiltrado.length === 0 && <div style={{ textAlign: 'center', padding: 24, color: '#9A9488', fontSize: 14 }}>Nenhum lançamento com esses filtros.</div>}
          </div>
        ) : (
          <div style={{ background: '#FFF', border: '1px solid #E5E0D5', borderRadius: 10, padding: 24 }}>
            <div style={{ fontSize: 12, letterSpacing: '0.1em', color: '#9A8B6F', textTransform: 'uppercase', fontWeight: 700, marginBottom: 14 }}>Comparativo dos segmentos</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead><tr>
                <th style={{ textAlign: 'left', padding: '8px 10px', color: '#9A9488', fontWeight: 600, fontSize: 12 }}>Indicador</th>
                <th style={{ textAlign: 'right', padding: '8px 10px', color: '#2A5A7A', fontWeight: 700 }}>Particular</th>
                <th style={{ textAlign: 'right', padding: '8px 10px', color: '#8A5A2B', fontWeight: 700 }}>Convênio</th>
                <th style={{ textAlign: 'right', padding: '8px 10px', color: '#1A3D2E', fontWeight: 700 }}>Geral</th>
              </tr></thead>
              <tbody>
                {[
                  ['Sessões', NUM(particular.sessoes), NUM(conv.sessoes), NUM(totalClinica.sessoes)],
                  ['Receita', BRL(particular.receita), BRL(conv.receita), BRL(totalClinica.receita)],
                  ['Repasse', BRL(particular.repasse), BRL(conv.repasse), BRL(totalClinica.repasse)],
                  ['Margem contribuição', BRL(particular.mc), BRL(conv.mc), BRL(totalClinica.mc)],
                  ['Margem %', PCT(particular.receita ? particular.mc / particular.receita * 100 : 0), PCT(conv.receita ? conv.mc / conv.receita * 100 : 0), PCT(totalClinica.receita ? totalClinica.mc / totalClinica.receita * 100 : 0)],
                  ['Ticket médio', BRL(particular.sessoes ? particular.receita / particular.sessoes : 0), BRL(conv.sessoes ? conv.receita / conv.sessoes : 0), BRL(totalClinica.sessoes ? totalClinica.receita / totalClinica.sessoes : 0)],
                ].map((row, i) => (
                  <tr key={i} style={{ borderTop: '1px solid #EEEAE0' }}>
                    <td style={{ padding: '9px 10px', color: '#6A6A6A' }}>{row[0]}</td>
                    <td style={{ padding: '9px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{row[1]}</td>
                    <td style={{ padding: '9px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{row[2]}</td>
                    <td style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', background: '#F7F5EF' }}>{row[3]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ fontSize: 11, color: '#B0A99C', marginTop: 12, lineHeight: 1.5 }}>
              Particular e Geral usam o total da clínica de junho (390 sessões) como base; o Convênio vem da planilha em tempo real. Quando você publicar também o total mensal, dá para deixar tudo ao vivo.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
