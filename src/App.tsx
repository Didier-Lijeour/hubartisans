import { useEffect, useMemo, useState, type FormEvent } from "react";
import { supabase } from "./lib/supabase";

type Mode = "terrain" | "bureau";

const DEMO_ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";


type Project = {
  id: string;
  name: string;
  client: string;
  clientId: string | null;
  city: string;
  status: string;
  revenue: number;
  expenses: number;
  laborCost: number;
};

type Expense = {
  id: string;
  projectId: string;
  supplier: string;
  category: string;
  amount: number;
  note?: string;
};

type TimeEntry = {
  id: string;
  projectId: string;
  label: string;
  hours: number;
  hourlyRate: number;
};

type DocumentItem = {
  id: string;
  projectId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  status: "À analyser" | "Analysé";
  storagePath: string;
  note?: string;
};

type SupabaseProjectRow = {
  id: string;
  client_id: string | null;
  name: string;
  city: string | null;
  status: string;
  accepted_quote_amount: number | null;
  planned_budget: number | null;
  expenses_total: number | null;
  labor_cost_total: number | null;
  clients:
    | { first_name: string | null; last_name: string | null; company_name: string | null }
    | { first_name: string | null; last_name: string | null; company_name: string | null }[]
    | null;
};

type SupabaseDocumentRow = {
  id: string;
  project_id: string | null;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  status: string;
  storage_path: string;
};

const DOCUMENTS_BUCKET = "hub-artisans-documents";

const initialExpenses: Expense[] = [
  { id: "e1", projectId: "31111111-1111-4111-8111-111111111111", supplier: "Alu Bretagne Distribution", category: "Matériaux", amount: 3360 },
  { id: "e2", projectId: "31111111-1111-4111-8111-111111111111", supplier: "Location Pro", category: "Location matériel", amount: 300 },
  { id: "e3", projectId: "32222222-2222-4222-8222-222222222222", supplier: "Alu Bretagne Distribution", category: "Matériaux", amount: 2520 },
];

const initialTimeEntries: TimeEntry[] = [
  { id: "t1", projectId: "31111111-1111-4111-8111-111111111111", label: "Dépose ancienne baie et préparation", hours: 7, hourlyRate: 45 },
  { id: "t2", projectId: "31111111-1111-4111-8111-111111111111", label: "Pose baie vitrée", hours: 8, hourlyRate: 45 },
  { id: "t3", projectId: "32222222-2222-4222-8222-222222222222", label: "Préparation chantier portail", hours: 5, hourlyRate: 45 },
];

const initialDocuments: DocumentItem[] = [
  { id: "d1", projectId: "31111111-1111-4111-8111-111111111111", fileName: "facture-alu-bretagne.pdf", fileType: "application/pdf", fileSize: 245000, status: "À analyser", storagePath: "demo/facture-alu-bretagne.pdf", note: "Facture fournisseur à rapprocher" },
];

function euros(value: number) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value || 0);
}

function fileSize(value: number) {
  if (value < 1024) return `${value} o`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} Ko`;
  return `${(value / 1024 / 1024).toFixed(1)} Mo`;
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    in_progress: "En cours",
    accepted: "Accepté",
    preparation: "Préparation",
    to_quote: "À chiffrer",
    completed: "Terminé",
  };
  return labels[status] || status;
}


function expenseCategoryToSupabase(category: string) {
  const map: Record<string, string> = {
    "Matériaux": "materials",
    "Location matériel": "equipment_rental",
    "Carburant / déplacement": "fuel_travel",
    "Sous-traitance": "subcontracting",
    "Outillage": "tools",
    "Consommables": "consumables",
    "Autre": "other",
  };

  return map[category] || "other";
}

function clientName(clientData: SupabaseProjectRow["clients"]) {
  const client = Array.isArray(clientData) ? clientData[0] : clientData;
  if (!client) return "Client non renseigné";
  if (client.company_name) return client.company_name;
  return `${client.first_name || ""} ${client.last_name || ""}`.trim() || "Client non renseigné";
}

function mapProject(row: SupabaseProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    client: clientName(row.clients),
    clientId: row.client_id,
    city: row.city || "",
    status: row.status,
    revenue: row.accepted_quote_amount ?? row.planned_budget ?? 0,
    expenses: row.expenses_total ?? 0,
    laborCost: row.labor_cost_total ?? 0,
  };
}

function mapDocument(row: SupabaseDocumentRow): DocumentItem {
  return {
    id: row.id,
    projectId: row.project_id || "",
    fileName: row.file_name,
    fileType: row.mime_type || "Fichier",
    fileSize: row.size_bytes || 0,
    status: row.status === "processed" || row.status === "analysed" || row.status === "analyzed" ? "Analysé" : "À analyser",
    storagePath: row.storage_path,
  };
}

function cleanFileName(name: string) {
  const fallback = "document";
  const safe = (name || fallback)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

  return safe || fallback;
}

function supabaseErrorDetails(error: any) {
  if (!error) return "Erreur inconnue.";

  const parts = [
    error.message ? `message=${error.message}` : "",
    error.code ? `code=${error.code}` : "",
    error.details ? `details=${error.details}` : "",
    error.hint ? `hint=${error.hint}` : "",
  ].filter(Boolean);

  return parts.join(" · ") || JSON.stringify(error);
}

function realCost(project: Project) {
  return project.expenses + project.laborCost;
}

function margin(project: Project) {
  return project.revenue - realCost(project);
}

function marginRate(project: Project) {
  return project.revenue > 0 ? (margin(project) / project.revenue) * 100 : 0;
}

function Badge({ status }: { status: string }) {
  return <span className={`badge badge-${status}`}>{statusLabel(status)}</span>;
}

function Login({ loading, error, onLogin }: { loading: boolean; error: string; onLogin: () => void }) {
  return (
    <main className="login-page">
      <section className="login-card">
        <div className="brand-icon big">H</div>
        <h1>HUB Artisans</h1>
        <p>Connexion au projet Supabase HUB Artisans.</p>
        {error && <div className="error">{error}</div>}
        <button className="primary" onClick={onLogin} disabled={loading}>{loading ? "Connexion..." : "Se connecter en démo"}</button>
        <span>demo@hubartisans.fr · demo1234</span>
      </section>
    </main>
  );
}

function Sidebar({ mode, page, setPage }: { mode: Mode; page: string; setPage: (page: string) => void }) {
  const items = mode === "terrain"
    ? ["Terrain", "Chantiers", "Dépenses", "Temps passé", "Documents IA"]
    : ["Dashboard", "Chantiers", "Clients", "Devis", "Dépenses", "Temps passé", "Factures", "Paiements", "Documents IA", "Réglages"];

  return (
    <aside className="sidebar">
      <div className="brand"><div className="brand-icon">H</div><div><strong>HUB Artisans</strong><span>{mode === "terrain" ? "Mode terrain" : "Back office"}</span></div></div>
      <nav>{items.map((item) => <button key={item} className={page === item ? "active" : ""} onClick={() => setPage(item)}>{item}</button>)}</nav>
    </aside>
  );
}

function ModeToggle({ mode, setMode }: { mode: Mode; setMode: (mode: Mode) => void }) {
  return <div className="mode-toggle"><button className={mode === "terrain" ? "selected" : ""} onClick={() => setMode("terrain")}>Terrain</button><button className={mode === "bureau" ? "selected" : ""} onClick={() => setMode("bureau")}>Bureau</button></div>;
}

function Stat({ title, value, helper }: { title: string; value: string; helper?: string }) {
  return <div className="stat"><p>{title}</p><strong>{value}</strong>{helper && <span>{helper}</span>}</div>;
}

function FieldPage({ projects, docs, openProject, openExpense, openTime, openDoc }: { projects: Project[]; docs: DocumentItem[]; openProject: (p: Project) => void; openExpense: () => void; openTime: () => void; openDoc: () => void }) {
  const active = projects.filter((p) => ["in_progress", "accepted", "preparation", "to_quote"].includes(p.status));
  const alerts = active.filter((p) => marginRate(p) < 20).length + docs.filter((d) => d.status === "À analyser").length;

  return <main className="content field-content">
    <section className="hero"><div><span>Mode terrain · Supabase</span><h1>Mes chantiers</h1><p>Les chantiers sont chargés depuis Supabase.</p></div><div className="alert-count"><strong>{alerts}</strong><span>alerte(s)</span></div></section>
    <section className="quick"><button onClick={openExpense}>+ Dépense</button><button onClick={openTime}>+ Temps</button><button onClick={openDoc}>📷 Facture</button></section>
    <section className="cards">
      {active.map((p) => {
        const rate = marginRate(p);
        const danger = rate < 20;
        const countDocs = docs.filter((d) => d.projectId === p.id).length;
        return <button key={p.id} className={`field-card ${danger ? "danger" : ""}`} onClick={() => openProject(p)}>
          <div className="card-head"><div><h2>{p.name}</h2><p>{p.client} — {p.city}</p></div><Badge status={p.status} /></div>
          <div className="profit-row"><div className={`circle ${danger ? "danger" : ""}`}><strong>{rate.toFixed(0)}%</strong><span>marge</span></div><div><strong>{danger ? "À surveiller" : "Sous contrôle"}</strong><span>{danger ? "La rentabilité est sous le seuil." : "Le chantier reste rentable."}</span>{countDocs > 0 && <em>{countDocs} document(s) joint(s)</em>}</div></div>
          <div className="footer"><span>Voir le détail</span><span>→</span></div>
        </button>;
      })}
    </section>
  </main>;
}

function Dashboard({ projects, docs, openProject, refresh }: { projects: Project[]; docs: DocumentItem[]; openProject: (p: Project) => void; refresh: () => void }) {
  const totalRevenue = projects.reduce((s, p) => s + p.revenue, 0);
  const totalCost = projects.reduce((s, p) => s + realCost(p), 0);
  const average = totalRevenue ? ((totalRevenue - totalCost) / totalRevenue) * 100 : 0;
  const low = projects.filter((p) => marginRate(p) < 20);

  return <main className="content">
    <div className="page-header"><div><h1>Tableau de bord bureau</h1><p>Données chantiers lues depuis Supabase.</p></div><button className="primary" onClick={refresh}>Rafraîchir Supabase</button></div>
    <section className="stats"><Stat title="Chantiers" value={String(projects.length)} helper="Depuis Supabase" /><Stat title="CA prévu" value={euros(totalRevenue)} /><Stat title="Coût réel" value={euros(totalCost)} /><Stat title="Marge moyenne" value={`${average.toFixed(1)} %`} /></section>
    <section className="columns"><div className="panel"><h2>À traiter</h2><div className="todo warning"><strong>{low.length} chantier(s) en alerte marge</strong><span>À vérifier.</span></div><div className="todo"><strong>{docs.filter(d => d.status === "À analyser").length} document(s) à analyser</strong><span>Documents à traiter dans Supabase.</span></div></div><div className="panel"><h2>Alertes marge</h2>{low.length === 0 ? <p className="empty">Aucune alerte.</p> : low.map((p) => <div className="alert" key={p.id}><strong>{p.name}</strong><span>{marginRate(p).toFixed(1)} %</span></div>)}</div></section>
    <section className="panel"><h2>Rentabilité des chantiers</h2><div className="table"><div className="row head"><span>Chantier</span><span>Client</span><span>Statut</span><span>CA</span><span>Coût</span><span>Marge</span><span>Taux</span></div>{projects.map((p) => <button key={p.id} className="row clickable" onClick={() => openProject(p)}><span>{p.name}</span><span>{p.client}</span><span><Badge status={p.status} /></span><span>{euros(p.revenue)}</span><span>{euros(realCost(p))}</span><span>{euros(margin(p))}</span><span className={marginRate(p) < 20 ? "danger-text" : "success-text"}>{marginRate(p).toFixed(1)} %</span></button>)}</div></section>
  </main>;
}

function ProjectsPage({ projects, openProject }: { projects: Project[]; openProject: (p: Project) => void }) {
  const [search, setSearch] = useState("");
  const filtered = projects.filter((p) => `${p.name} ${p.client} ${p.city}`.toLowerCase().includes(search.toLowerCase()));
  return <main className="content"><div className="page-header"><div><h1>Chantiers</h1><p>Liste chargée depuis Supabase.</p></div><button className="primary">+ Nouveau chantier</button></div><input className="search" placeholder="Rechercher..." value={search} onChange={(e) => setSearch(e.target.value)} /><section className="grid">{filtered.map((p) => <button key={p.id} className="project-card" onClick={() => openProject(p)}><div className="card-head"><div><h2>{p.name}</h2><p>{p.client} — {p.city}</p></div><Badge status={p.status} /></div><div className="numbers"><div><span>CA</span><strong>{euros(p.revenue)}</strong></div><div><span>Coût</span><strong>{euros(realCost(p))}</strong></div><div><span>Marge</span><strong>{euros(margin(p))}</strong></div></div><div className="margin-line"><span>Taux de marge</span><strong className={marginRate(p) < 20 ? "danger-text" : "success-text"}>{marginRate(p).toFixed(1)} %</strong></div></button>)}</section></main>;
}

function ExpenseForm({ projects, defaultProjectId, cancel, save }: { projects: Project[]; defaultProjectId?: string; cancel: () => void; save: (e: Expense) => Promise<void> }) {
  const [projectId, setProjectId] = useState(defaultProjectId || projects[0]?.id || "");
  const [supplier, setSupplier] = useState("");
  const [category, setCategory] = useState("Matériaux");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const project = projects.find((p) => p.id === projectId);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");

    const parsed = Number(amount.replace(",", "."));
    if (!projectId) return setError("Choisis un chantier.");
    if (!supplier.trim()) return setError("Indique le fournisseur.");
    if (!parsed || parsed <= 0) return setError("Indique un montant valide.");

    setSaving(true);
    try {
      await save({
        id: `e-${Date.now()}`,
        projectId,
        supplier: supplier.trim(),
        category,
        amount: parsed,
        note: note.trim() || undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur pendant l’enregistrement Supabase.");
    } finally {
      setSaving(false);
    }
  }

  return <main className="content field-content"><button className="back" onClick={cancel}>← Retour</button><div className="page-header"><div><h1>Ajouter une dépense</h1><p>Cette dépense sera enregistrée dans Supabase puis les chantiers seront rafraîchis.</p></div></div><form className="form" onSubmit={submit}>{error && <div className="error">{error}</div>}<label>Chantier<select value={projectId} onChange={(e) => setProjectId(e.target.value)}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.client}</option>)}</select></label>{project && <div className="summary"><strong>{project.name}</strong><span>Dépenses : {euros(project.expenses)} · Marge : {marginRate(project).toFixed(0)} %</span></div>}<label>Fournisseur<input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Ex : Point.P" /></label><label>Catégorie<select value={category} onChange={(e) => setCategory(e.target.value)}><option>Matériaux</option><option>Location matériel</option><option>Carburant / déplacement</option><option>Sous-traitance</option><option>Outillage</option><option>Consommables</option><option>Autre</option></select></label><label>Montant TTC<input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Ex : 246,80" /></label><label>Note facultative<textarea value={note} onChange={(e) => setNote(e.target.value)} /></label><div className="info"><strong>Écriture Supabase</strong><span>V1 : le montant TTC est enregistré, HT et TVA restent à 0 pour garder la saisie terrain simple.</span></div><div className="actions right"><button type="button" className="secondary" onClick={cancel} disabled={saving}>Annuler</button><button type="submit" className="primary" disabled={saving}>{saving ? "Enregistrement..." : "Enregistrer dans Supabase"}</button></div></form></main>;
}

function TimeForm({ projects, defaultProjectId, cancel, save }: { projects: Project[]; defaultProjectId?: string; cancel: () => void; save: (t: TimeEntry) => Promise<void> }) {
  const [projectId, setProjectId] = useState(defaultProjectId || projects[0]?.id || "");
  const [hours, setHours] = useState("");
  const [hourlyRate, setHourlyRate] = useState("45");
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const project = projects.find((p) => p.id === projectId);
  const cost = (Number(hours.replace(",", ".")) || 0) * (Number(hourlyRate.replace(",", ".")) || 0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const h = Number(hours.replace(",", "."));
    const r = Number(hourlyRate.replace(",", "."));
    if (!projectId) return setError("Choisis un chantier.");
    if (!h || h <= 0) return setError("Indique un nombre d’heures valide.");
    if (!r || r <= 0) return setError("Indique un taux horaire valide.");
    try {
      setSaving(true);
      await save({ id: `t-${Date.now()}`, projectId, label: label.trim() || "Temps passé sur chantier", hours: h, hourlyRate: r });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible d’enregistrer le temps dans Supabase.");
    } finally {
      setSaving(false);
    }
  }

  return <main className="content field-content"><button className="back" onClick={cancel}>← Retour</button><div className="page-header"><div><h1>Ajouter du temps</h1><p>Ce temps sera enregistré dans Supabase puis les chantiers seront rafraîchis.</p></div></div><form className="form" onSubmit={submit}>{error && <div className="error">{error}</div>}<label>Chantier<select value={projectId} onChange={(e) => setProjectId(e.target.value)}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.client}</option>)}</select></label>{project && <div className="summary"><strong>{project.name}</strong><span>Main-d’œuvre : {euros(project.laborCost)} · Marge : {marginRate(project).toFixed(0)} %</span></div>}<label>Nombre d’heures<input inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="Ex : 2,5" /></label><label>Taux horaire<input inputMode="decimal" value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} /></label><label>Description<textarea value={label} onChange={(e) => setLabel(e.target.value)} /></label><div className="summary"><strong>Coût estimé</strong><span>{euros(cost)}</span></div><div className="info"><strong>Écriture Supabase</strong><span>Le total est calculé automatiquement par Supabase : heures x taux horaire.</span></div><div className="actions right"><button type="button" className="secondary" onClick={cancel} disabled={saving}>Annuler</button><button type="submit" className="primary" disabled={saving}>{saving ? "Enregistrement..." : "Enregistrer dans Supabase"}</button></div></form></main>;
}

function DocumentForm({ projects, defaultProjectId, cancel, save }: { projects: Project[]; defaultProjectId?: string; cancel: () => void; save: (d: { projectId: string; file: File; note?: string }) => Promise<void> }) {
  const [projectId, setProjectId] = useState(defaultProjectId || projects[0]?.id || "");
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const project = projects.find((p) => p.id === projectId);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!projectId) return setError("Choisis un chantier.");
    if (!file) return setError("Ajoute une photo ou un document.");

    try {
      setSaving(true);
      await save({ projectId, file, note: note.trim() || undefined });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible d’envoyer le document dans Supabase.");
    } finally {
      setSaving(false);
    }
  }

  return <main className="content field-content"><button className="back" onClick={cancel} disabled={saving}>← Retour</button><div className="page-header"><div><h1>Photo facture / Document IA</h1><p>Photo terrain ou import PDF/image, envoyé dans Supabase Storage.</p></div></div><form className="form" onSubmit={submit}>{error && <div className="error">{error}</div>}<label>Chantier<select value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={saving}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.client}</option>)}</select></label>{project && <div className="summary"><strong>{project.name}</strong><span>Le fichier sera rangé dans Supabase Storage et rattaché à ce chantier.</span></div>}<label>📷 Prendre une photo ou joindre un fichier<input type="file" accept="image/*,.pdf" capture="environment" disabled={saving} onChange={(e) => setFile(e.target.files?.[0] || null)} /></label>{file && <div className="doc"><strong>{file.name}</strong><span>{file.type || "Fichier"} · {fileSize(file.size)}</span><em>Statut : à analyser</em></div>}<label>Note facultative<textarea value={note} onChange={(e) => setNote(e.target.value)} disabled={saving} placeholder="Ex : ticket de caisse, facture fournisseur, reçu par mail..." /></label><div className="info"><strong>Écriture Supabase</strong><span>Le fichier est envoyé dans le bucket privé hub-artisans-documents puis une ligne est créée dans la table documents.</span></div><div className="actions right"><button type="button" className="secondary" onClick={cancel} disabled={saving}>Annuler</button><button type="submit" className="primary" disabled={saving}>{saving ? "Envoi du document..." : "Envoyer dans Supabase"}</button></div></form></main>;
}

function DocumentsPage({ projects, docs, openDoc, openStoredDocument }: { projects: Project[]; docs: DocumentItem[]; openDoc: () => void; openStoredDocument: (document: DocumentItem) => Promise<void> }) {
  return <main className="content"><div className="page-header"><div><h1>Documents IA</h1><p>Documents enregistrés dans Supabase Storage et rattachés aux chantiers.</p></div><button className="primary" onClick={openDoc}>+ Document</button></div><section className="panel"><h2>Documents ajoutés</h2>{docs.length === 0 ? <p className="empty">Aucun document.</p> : <div className="doc-list">{docs.map((d) => { const p = projects.find((x) => x.id === d.projectId); return <div className="doc-item" key={d.id}><div><strong>{d.fileName}</strong><span>{p?.name || "Chantier inconnu"} · {fileSize(d.fileSize)}</span><small>{d.storagePath}</small>{d.note && <em>{d.note}</em>}</div><div className="doc-actions"><span className="doc-status">{d.status}</span><button type="button" className="open-doc" onClick={() => openStoredDocument(d)}>Ouvrir</button></div></div>; })}</div>}</section></main>;
}

function ProjectDetail({ project, expenses, times, docs, back, openExpense, openTime, openDoc, openStoredDocument }: { project: Project; expenses: Expense[]; times: TimeEntry[]; docs: DocumentItem[]; back: () => void; openExpense: (id: string) => void; openTime: (id: string) => void; openDoc: (id: string) => void; openStoredDocument: (document: DocumentItem) => Promise<void> }) {
  const projectExpenses = expenses.filter((e) => e.projectId === project.id);
  const projectTimes = times.filter((t) => t.projectId === project.id);
  const projectDocs = docs.filter((d) => d.projectId === project.id);
  const rate = marginRate(project);

  return <main className="content"><button className="back" onClick={back}>← Retour</button><div className="page-header"><div><h1>{project.name}</h1><p>{project.client} — {project.city}</p></div><Badge status={project.status} /></div><section className="stats"><Stat title="Revenu chantier" value={euros(project.revenue)} /><Stat title="Dépenses" value={euros(project.expenses)} /><Stat title="Main-d’œuvre" value={euros(project.laborCost)} /><Stat title="Marge réelle" value={euros(margin(project))} helper={`${rate.toFixed(1)} % de marge`} /></section>{rate < 20 && <div className="big-alert"><strong>Attention : marge basse</strong><span>Ce chantier est sous le seuil minimum.</span></div>}<section className="columns"><div className="panel"><div className="panel-head"><h2>Dépenses liées</h2><button onClick={() => openExpense(project.id)}>+ Ajouter</button></div>{projectExpenses.length === 0 ? <p className="empty">Aucune dépense rattachée en local sur cette session.</p> : projectExpenses.map((e) => <div className="line" key={e.id}><div><strong>{e.supplier}</strong><span>{e.category}{e.note ? ` · ${e.note}` : ""}</span></div><strong>{euros(e.amount)}</strong></div>)}</div><div className="panel"><div className="panel-head"><h2>Temps passé</h2><button onClick={() => openTime(project.id)}>+ Ajouter</button></div>{projectTimes.length === 0 ? <p className="empty">Aucun temps local.</p> : projectTimes.map((t) => <div className="line" key={t.id}><div><strong>{t.label}</strong><span>{t.hours} h x {euros(t.hourlyRate)}</span></div><strong>{euros(t.hours * t.hourlyRate)}</strong></div>)}</div></section><section className="panel"><div className="panel-head"><h2>Documents chantier</h2><button onClick={() => openDoc(project.id)}>+ Document</button></div>{projectDocs.length === 0 ? <p className="empty">Aucun document rattaché.</p> : <div className="doc-list">{projectDocs.map((d) => <div className="doc-item" key={d.id}><div><strong>{d.fileName}</strong><span>{d.fileType} · {fileSize(d.fileSize)}</span><small>{d.storagePath}</small>{d.note && <em>{d.note}</em>}</div><div className="doc-actions"><span className="doc-status">{d.status}</span><button type="button" className="open-doc" onClick={() => openStoredDocument(d)}>Ouvrir</button></div></div>)}</div>}</section><section className="panel"><h2>Actions rapides</h2><div className="actions"><button onClick={() => openExpense(project.id)}>Ajouter une dépense</button><button onClick={() => openTime(project.id)}>Ajouter du temps</button><button onClick={() => openDoc(project.id)}>Joindre un document</button><button>Créer une facture</button></div></section></main>;
}

function Placeholder({ title }: { title: string }) {
  return <main className="content"><div className="page-header"><div><h1>{title}</h1><p>Module en préparation.</p></div></div><div className="panel"><h2>À venir</h2><p className="empty">Les chantiers sont connectés à Supabase. Les écritures seront branchées étape par étape.</p></div></main>;
}

export default function App() {
  const [mode, setMode] = useState<Mode>("terrain");
  const [page, setPage] = useState("Terrain");
  const [selected, setSelected] = useState<Project | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>(initialExpenses);
  const [times, setTimes] = useState<TimeEntry[]>(initialTimeEntries);
  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [defaultExpenseProjectId, setDefaultExpenseProjectId] = useState<string | undefined>();
  const [defaultTimeProjectId, setDefaultTimeProjectId] = useState<string | undefined>();
  const [defaultDocProjectId, setDefaultDocProjectId] = useState<string | undefined>();
  const [userEmail, setUserEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadProjects() {
    setLoading(true);
    setError("");
    const { data, error } = await supabase
      .from("projects")
      .select("id, client_id, name, city, status, accepted_quote_amount, planned_budget, expenses_total, labor_cost_total, clients(first_name,last_name,company_name)")
      .order("name", { ascending: true });

    if (error) {
      setError(error.message);
      setProjects([]);
    } else {
      setProjects(((data || []) as SupabaseProjectRow[]).map(mapProject));
    }
    setLoading(false);
  }

  async function loadDocuments() {
    const { data, error } = await supabase
      .from("documents")
      .select("id, project_id, file_name, mime_type, size_bytes, status, storage_path")
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    setDocs(((data || []) as SupabaseDocumentRow[]).map(mapDocument));
  }

  async function refreshAll() {
    await loadProjects();
    await loadDocuments();
  }


  async function loginDemo() {
    setLoading(true);
    setError("");
    const { data, error } = await supabase.auth.signInWithPassword({ email: "demo@hubartisans.fr", password: "demo1234" });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    setUserEmail(data.user?.email || "");
    await refreshAll();
  }

  async function logout() {
    await supabase.auth.signOut();
    setUserEmail("");
    setProjects([]);
    setSelected(null);
    setPage("Terrain");
  }

  useEffect(() => {
    async function check() {
      const { data } = await supabase.auth.getSession();
      if (data.session?.user?.email) {
        setUserEmail(data.session.user.email);
        await refreshAll();
      } else {
        setLoading(false);
      }
    }
    check();
  }, []);

  function switchMode(next: Mode) {
    setMode(next);
    setSelected(null);
    setPage(next === "terrain" ? "Terrain" : "Dashboard");
  }

  function openProject(project: Project) {
    setSelected(projects.find((p) => p.id === project.id) || project);
    setPage("Fiche chantier");
  }

  function openExpense(projectId?: string) {
    setDefaultExpenseProjectId(projectId);
    setPage("Ajouter une dépense");
  }

  function openTime(projectId?: string) {
    setDefaultTimeProjectId(projectId);
    setPage("Ajouter du temps");
  }

  function openDoc(projectId?: string) {
    setDefaultDocProjectId(projectId);
    setPage("Ajouter un document");
  }

  async function saveExpense(expense: Expense) {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    const project = projects.find((p) => p.id === expense.projectId);

    if (!userId) {
      throw new Error("Utilisateur non connecté. Déconnecte-toi puis reconnecte-toi en démo.");
    }

    if (!project) {
      throw new Error("Chantier introuvable.");
    }

    const { data: insertedExpense, error: insertError } = await supabase
      .from("expenses")
      .insert({
        organization_id: DEMO_ORGANIZATION_ID,
        project_id: expense.projectId,
        supplier_name: expense.supplier,
        category: expenseCategoryToSupabase(expense.category),
        amount_ht: 0,
        vat_amount: 0,
        amount_ttc: expense.amount,
        status: "to_review",
        notes: expense.note || null,
        created_by: userId,
      })
      .select("id")
      .single();

    if (insertError) {
      throw new Error(insertError.message);
    }

    const nextExpensesTotal = project.expenses + expense.amount;
    const nextRealCost = nextExpensesTotal + project.laborCost;
    const nextRealMargin = project.revenue - nextRealCost;
    const nextRealMarginRate = project.revenue > 0 ? (nextRealMargin / project.revenue) * 100 : 0;

    const { error: updateError } = await supabase
      .from("projects")
      .update({
        expenses_total: nextExpensesTotal,
        real_cost_total: nextRealCost,
        real_margin: nextRealMargin,
        real_margin_rate: nextRealMarginRate,
      })
      .eq("id", expense.projectId);

    if (updateError) {
      throw new Error(`Dépense créée, mais mise à jour du chantier impossible : ${updateError.message}`);
    }

    setExpenses((current) => [
      { ...expense, id: insertedExpense?.id || expense.id },
      ...current,
    ]);

    await loadProjects();

    setDefaultExpenseProjectId(undefined);
    setPage(mode === "terrain" ? "Terrain" : "Chantiers");
  }

  async function saveTime(entry: TimeEntry) {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    const project = projects.find((p) => p.id === entry.projectId);

    if (!userId) {
      throw new Error("Utilisateur non connecté. Déconnecte-toi puis reconnecte-toi en démo.");
    }

    if (!project) {
      throw new Error("Chantier introuvable.");
    }

    const amount = entry.hours * entry.hourlyRate;

    const { data: insertedTime, error: insertError } = await supabase
      .from("time_entries")
      .insert({
        organization_id: DEMO_ORGANIZATION_ID,
        project_id: entry.projectId,
        user_id: userId,
        hours: entry.hours,
        hourly_rate: entry.hourlyRate,
        description: entry.label,
        status: "validated",
      })
      .select("id")
      .single();

    if (insertError) {
      throw new Error(insertError.message);
    }

    const nextLaborCost = project.laborCost + amount;
    const nextRealCost = project.expenses + nextLaborCost;
    const nextRealMargin = project.revenue - nextRealCost;
    const nextRealMarginRate = project.revenue > 0 ? (nextRealMargin / project.revenue) * 100 : 0;

    const { error: updateError } = await supabase
      .from("projects")
      .update({
        labor_cost_total: nextLaborCost,
        real_cost_total: nextRealCost,
        real_margin: nextRealMargin,
        real_margin_rate: nextRealMarginRate,
      })
      .eq("id", entry.projectId);

    if (updateError) {
      throw new Error(`Temps créé, mais mise à jour du chantier impossible : ${updateError.message}`);
    }

    setTimes((current) => [
      { ...entry, id: insertedTime?.id || entry.id },
      ...current,
    ]);

    await loadProjects();

    setDefaultTimeProjectId(undefined);
    setPage(mode === "terrain" ? "Terrain" : "Chantiers");
  }

  async function saveDoc(doc: { projectId: string; file: File; note?: string }) {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    const project = projects.find((p) => p.id === doc.projectId);

    if (userError) {
      throw new Error(`Impossible de récupérer l’utilisateur connecté : ${supabaseErrorDetails(userError)}`);
    }

    if (!userId) {
      throw new Error("Utilisateur non connecté. Déconnecte-toi puis reconnecte-toi en démo.");
    }

    if (!project) {
      throw new Error("Chantier introuvable. Rafraîchis Supabase puis réessaie.");
    }

    if (!doc.file) {
      throw new Error("Aucun fichier sélectionné.");
    }

    const fileName = cleanFileName(doc.file.name);
    const storagePath = `${DEMO_ORGANIZATION_ID}/${doc.projectId}/${Date.now()}-${fileName}`;

    // Étape 1 : envoyer le fichier dans Supabase Storage.
    const { error: uploadError } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .upload(storagePath, doc.file, {
        cacheControl: "3600",
        upsert: false,
        contentType: doc.file.type || "application/octet-stream",
      });

    if (uploadError) {
      throw new Error(`Étape 1/2 échouée — upload Storage impossible : ${supabaseErrorDetails(uploadError)}`);
    }

    // Étape 2 : créer la ligne correspondante dans public.documents.
    const documentPayload = {
      organization_id: DEMO_ORGANIZATION_ID,
      client_id: project.clientId || null,
      project_id: doc.projectId,
      document_type: "supplier_invoice",
      file_name: doc.file.name,
      storage_path: storagePath,
      mime_type: doc.file.type || null,
      size_bytes: doc.file.size,
      status: "to_process",
      uploaded_by: userId,
    };

    const { data: insertedRows, error: insertError } = await supabase
      .from("documents")
      .insert(documentPayload)
      .select("id, project_id, file_name, mime_type, size_bytes, status, storage_path");

    if (insertError) {
      // On tente de nettoyer le fichier envoyé pour éviter un fichier orphelin.
      const { error: removeError } = await supabase.storage
        .from(DOCUMENTS_BUCKET)
        .remove([storagePath]);

      const cleanupMessage = removeError
        ? ` Nettoyage Storage impossible : ${supabaseErrorDetails(removeError)}`
        : " Le fichier envoyé a été retiré du Storage.";

      throw new Error(
        `Étape 2/2 échouée — le fichier a été envoyé, mais la ligne documents n’a pas été créée : ${supabaseErrorDetails(insertError)}.${cleanupMessage}`
      );
    }

    const insertedDoc = insertedRows?.[0];

    if (!insertedDoc) {
      const { data: verificationRows, error: verificationError } = await supabase
        .from("documents")
        .select("id, project_id, file_name, mime_type, size_bytes, status, storage_path")
        .eq("storage_path", storagePath)
        .limit(1);

      if (verificationError) {
        throw new Error(
          `Document peut-être créé, mais impossible de le relire : ${supabaseErrorDetails(verificationError)}. Chemin Storage : ${storagePath}`
        );
      }

      if (!verificationRows || verificationRows.length === 0) {
        throw new Error(
          `Upload Storage réussi, mais aucune ligne documents n’a été retrouvée. Chemin Storage : ${storagePath}`
        );
      }

      setDocs((current) => [mapDocument(verificationRows[0] as SupabaseDocumentRow), ...current]);
    } else {
      setDocs((current) => [mapDocument(insertedDoc as SupabaseDocumentRow), ...current]);
    }

    // Étape 3 : recharger la liste depuis Supabase pour vérifier l’affichage réel.
    await loadDocuments();

    setDefaultDocProjectId(undefined);
    setPage(mode === "terrain" ? "Terrain" : "Documents IA");
  }

  async function openStoredDocument(document: DocumentItem) {
    try {
      if (!document.storagePath) {
        alert("Chemin Storage manquant pour ce document.");
        return;
      }

      const { data, error } = await supabase.storage
        .from(DOCUMENTS_BUCKET)
        .createSignedUrl(document.storagePath, 60);

      if (error || !data?.signedUrl) {
        alert(`Impossible d'ouvrir le document : ${supabaseErrorDetails(error)}`);
        return;
      }

      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (err: any) {
      alert(`Impossible d'ouvrir le document : ${err?.message || String(err)}`);
    }
  }

  function render() {
    if (loading && projects.length === 0) return <main className="content"><div className="panel"><h2>Chargement Supabase...</h2><p className="empty">Connexion au projet HUB Artisans.</p></div></main>;
    if (error) return <main className="content"><div className="big-alert"><strong>Erreur Supabase</strong><span>{error}</span></div><button className="primary" onClick={refreshAll}>Réessayer</button></main>;
    if (page === "Ajouter une dépense") return <ExpenseForm projects={projects} defaultProjectId={defaultExpenseProjectId} cancel={() => setPage(mode === "terrain" ? "Terrain" : "Chantiers")} save={saveExpense} />;
    if (page === "Ajouter du temps") return <TimeForm projects={projects} defaultProjectId={defaultTimeProjectId} cancel={() => setPage(mode === "terrain" ? "Terrain" : "Chantiers")} save={saveTime} />;
    if (page === "Ajouter un document") return <DocumentForm projects={projects} defaultProjectId={defaultDocProjectId} cancel={() => setPage(mode === "terrain" ? "Terrain" : "Documents IA")} save={saveDoc} />;
    if (page === "Fiche chantier" && selected) return <ProjectDetail project={projects.find((p) => p.id === selected.id) || selected} expenses={expenses} times={times} docs={docs} back={() => setPage(mode === "terrain" ? "Terrain" : "Chantiers")} openExpense={openExpense} openTime={openTime} openDoc={openDoc} openStoredDocument={openStoredDocument} />;
    if (mode === "terrain") {
      if (page === "Terrain" || page === "Chantiers") return <FieldPage projects={projects} docs={docs} openProject={openProject} openExpense={() => openExpense()} openTime={() => openTime()} openDoc={() => openDoc()} />;
      if (page === "Dépenses") return <ExpenseForm projects={projects} defaultProjectId={defaultExpenseProjectId} cancel={() => setPage("Terrain")} save={saveExpense} />;
      if (page === "Temps passé") return <TimeForm projects={projects} defaultProjectId={defaultTimeProjectId} cancel={() => setPage("Terrain")} save={saveTime} />;
      if (page === "Documents IA") return <DocumentsPage projects={projects} docs={docs} openDoc={() => openDoc()} openStoredDocument={openStoredDocument} />;
      return <Placeholder title={page} />;
    }
    if (page === "Dashboard") return <Dashboard projects={projects} docs={docs} openProject={openProject} refresh={refreshAll} />;
    if (page === "Chantiers") return <ProjectsPage projects={projects} openProject={openProject} />;
    if (page === "Dépenses") return <ExpenseForm projects={projects} defaultProjectId={defaultExpenseProjectId} cancel={() => setPage("Dashboard")} save={saveExpense} />;
    if (page === "Temps passé") return <TimeForm projects={projects} defaultProjectId={defaultTimeProjectId} cancel={() => setPage("Dashboard")} save={saveTime} />;
    if (page === "Documents IA") return <DocumentsPage projects={projects} docs={docs} openDoc={() => openDoc()} openStoredDocument={openStoredDocument} />;
    return <Placeholder title={page} />;
  }

  if (!userEmail) return <><style>{styles}</style><Login loading={loading} error={error} onLogin={loginDemo} /></>;

  return <><style>{styles}</style><div className="app"><Sidebar mode={mode} page={page} setPage={(next) => { setPage(next); if (next !== "Fiche chantier") setSelected(null); }} /><div className="main"><header className="topbar"><div><strong>Menuiserie Le Gall Aluminium</strong><span>{mode === "terrain" ? "Mode terrain — chantiers Supabase" : "Mode bureau — pilotage Supabase"}</span></div><div className="topbar-actions"><ModeToggle mode={mode} setMode={switchMode} /><button className="logout" onClick={logout}>Déconnexion</button><div className="user-pill">DL</div></div></header>{render()}</div></div></>;
}

const styles = `
*{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f4f6f8;color:#14213d}button,input,select,textarea{font:inherit}.login-page{min-height:100vh;background:#101828;display:grid;place-items:center;padding:24px}.login-card{width:100%;max-width:430px;background:white;border-radius:28px;padding:32px;text-align:center;box-shadow:0 24px 70px rgba(0,0,0,.2)}.login-card h1{margin:16px 0 8px;font-size:34px;letter-spacing:-.05em}.login-card p{color:#667085}.login-card span{display:block;margin-top:14px;color:#98a2b3;font-size:13px}.app{display:flex;min-height:100vh}.sidebar{width:265px;background:#101828;color:white;padding:24px 18px;display:flex;flex-direction:column;gap:28px}.brand{display:flex;align-items:center;gap:12px}.brand-icon{width:42px;height:42px;border-radius:14px;background:#f97316;display:flex;align-items:center;justify-content:center;font-weight:900;color:white}.brand-icon.big{width:58px;height:58px;border-radius:18px;margin:0 auto;font-size:24px}.brand strong{display:block;font-size:18px}.brand span{display:block;color:#98a2b3;font-size:13px}.sidebar nav{display:grid;gap:8px}.sidebar nav button{border:0;background:transparent;color:#cbd5e1;text-align:left;padding:12px 14px;border-radius:12px;cursor:pointer}.sidebar nav button:hover,.sidebar nav button.active{background:#1d2939;color:white}.main{flex:1;min-width:0}.topbar{min-height:72px;background:white;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;justify-content:space-between;padding:14px 32px;gap:16px}.topbar strong{display:block}.topbar span{display:block;color:#667085;font-size:14px}.topbar-actions{display:flex;align-items:center;gap:14px}.logout{border:1px solid #d0d5dd;background:white;color:#14213d;border-radius:999px;padding:8px 12px;font-weight:800;cursor:pointer}.mode-toggle{display:flex;background:#f2f4f7;padding:4px;border-radius:999px;border:1px solid #e5e7eb}.mode-toggle button{border:0;background:transparent;padding:8px 14px;border-radius:999px;cursor:pointer;font-weight:800;color:#667085}.mode-toggle button.selected{background:#14213d;color:white}.user-pill{width:42px;height:42px;border-radius:999px;background:#14213d;color:white;display:flex;align-items:center;justify-content:center;font-weight:800}.content{padding:32px}.field-content{max-width:780px;margin:0 auto}.hero{background:#14213d;color:white;border-radius:28px;padding:26px;display:flex;justify-content:space-between;gap:18px;align-items:center;margin-bottom:18px}.hero span{color:#fed7aa;font-weight:800;font-size:13px;text-transform:uppercase}.hero h1{margin:6px 0;font-size:34px;letter-spacing:-.05em}.hero p{margin:0;color:#d0d5dd}.alert-count{min-width:88px;height:88px;border-radius:24px;background:#f97316;display:flex;flex-direction:column;align-items:center;justify-content:center}.alert-count strong{font-size:30px;line-height:1}.alert-count span{color:white;text-transform:none}.quick{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:18px}.quick button{border:0;background:white;border-radius:18px;padding:16px 12px;font-weight:900;color:#14213d;box-shadow:0 10px 30px rgba(15,23,42,.04);border:1px solid #e5e7eb;cursor:pointer}.cards{display:grid;gap:14px}.field-card{border:1px solid #e5e7eb;background:white;border-radius:24px;padding:18px;text-align:left;cursor:pointer;box-shadow:0 10px 30px rgba(15,23,42,.04)}.field-card.danger{border-color:#fecaca;background:#fffafa}.card-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}.card-head h2{margin:0;font-size:20px;letter-spacing:-.03em}.card-head p{margin:6px 0 0;color:#667085}.profit-row{display:flex;align-items:center;gap:16px;margin-top:18px}.circle{min-width:92px;height:92px;border-radius:999px;background:#dcfce7;color:#15803d;display:flex;flex-direction:column;align-items:center;justify-content:center}.circle.danger{background:#fee2e2;color:#b91c1c}.circle strong{font-size:26px;line-height:1}.circle span{margin-top:4px;font-size:12px;font-weight:800}.profit-row strong{display:block;font-size:18px}.profit-row span{display:block;color:#667085;margin-top:4px}.profit-row em{display:block;color:#f97316;font-style:normal;font-weight:800;margin-top:8px}.footer{display:flex;justify-content:space-between;margin-top:16px;padding-top:14px;border-top:1px solid #eef2f6;color:#f97316;font-weight:900}.page-header{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:24px}.page-header h1{margin:0;font-size:32px;letter-spacing:-.04em}.page-header p{margin:8px 0 0;color:#667085}.primary,.panel-head button,.actions button{border:0;background:#f97316;color:white;border-radius:12px;padding:11px 16px;font-weight:700;cursor:pointer}.primary:disabled{opacity:.6;cursor:wait}.secondary{border:1px solid #d0d5dd;background:white;color:#14213d;border-radius:12px;padding:11px 16px;font-weight:700;cursor:pointer}.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin-bottom:24px}.stat,.panel,.project-card,.form{background:white;border:1px solid #e5e7eb;border-radius:22px;box-shadow:0 10px 30px rgba(15,23,42,.04)}.stat{padding:20px}.stat p{margin:0 0 10px;color:#667085;font-size:14px}.stat strong{display:block;font-size:26px;letter-spacing:-.04em}.stat span{display:block;color:#98a2b3;font-size:13px;margin-top:8px}.columns{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px}.panel{padding:22px}.panel h2{margin:0 0 16px;font-size:20px}.todo,.alert,.line,.summary{border:1px solid #eef2f6;background:#f8fafc;border-radius:16px;padding:14px;margin-bottom:10px}.todo strong,.alert strong,.line strong,.summary strong{display:block}.todo span,.alert span,.line span,.empty,.summary span{display:block;color:#667085;margin-top:4px;font-size:14px}.todo.warning,.big-alert,.info{background:#fff7ed;border:1px solid #fed7aa;border-radius:18px;padding:16px;margin-bottom:18px}.big-alert strong{display:block;color:#c2410c}.big-alert span,.info span{display:block;color:#9a3412;margin-top:4px}.form{padding:22px;display:grid;gap:16px}.form label{display:grid;gap:8px;color:#344054;font-weight:800}.form input,.form select,.form textarea{width:100%;border:1px solid #d0d5dd;border-radius:14px;padding:13px 14px;background:white;color:#14213d}.form textarea{min-height:96px;resize:vertical}.error{background:#fee2e2;color:#991b1b;border:1px solid #fecaca;border-radius:14px;padding:12px 14px;font-weight:800;margin:14px 0}.right{justify-content:flex-end}.table{display:grid;gap:6px}.row{display:grid;grid-template-columns:1.7fr 1.1fr .9fr .8fr .8fr .8fr .6fr;gap:12px;align-items:center;padding:14px;border-radius:14px;border:0;text-align:left;background:#f8fafc;color:inherit}.head{font-weight:800;color:#667085;background:transparent}.clickable{cursor:pointer}.clickable:hover{background:#eef2ff}.badge{display:inline-flex;align-items:center;justify-content:center;border-radius:999px;padding:6px 10px;font-size:12px;font-weight:800;white-space:nowrap;background:#f3f4f6;color:#374151}.badge-in_progress{background:#dbeafe;color:#1d4ed8}.badge-accepted{background:#dcfce7;color:#15803d}.badge-preparation{background:#fef3c7;color:#b45309}.badge-to_quote{background:#f3f4f6;color:#374151}.badge-completed{background:#e0e7ff;color:#4338ca}.danger-text{color:#dc2626;font-weight:800}.success-text{color:#16a34a;font-weight:800}.search{width:100%;border:1px solid #d0d5dd;border-radius:14px;padding:14px 16px;margin-bottom:20px;background:white}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.project-card{padding:20px;text-align:left;cursor:pointer}.project-card:hover{border-color:#f97316}.numbers{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:22px}.numbers span,.margin-line span{display:block;color:#667085;font-size:13px}.numbers strong{display:block;margin-top:4px}.margin-line{display:flex;justify-content:space-between;align-items:center;margin-top:18px;border-top:1px solid #eef2f6;padding-top:16px}.back{border:0;background:transparent;color:#f97316;font-weight:800;cursor:pointer;margin-bottom:16px}.panel-head{display:flex;justify-content:space-between;align-items:center}.panel-head button{padding:8px 12px;font-size:14px}.line{display:flex;justify-content:space-between;gap:16px}.actions{display:flex;gap:12px;flex-wrap:wrap}.doc,.doc-item{border:1px solid #eef2f6;background:#f8fafc;border-radius:16px;padding:14px}.doc strong,.doc span,.doc em{display:block}.doc span{color:#667085;margin-top:4px}.doc em{color:#f97316;font-style:normal;font-weight:800;margin-top:6px}.doc-list{display:grid;gap:12px}.doc-item{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.doc-item strong,.doc-item span,.doc-item em{display:block}.doc-item span{color:#667085;margin-top:4px}.doc-item em{color:#f97316;font-style:normal;font-weight:800;margin-top:4px}.doc-status{background:#fff7ed;color:#c2410c!important;border-radius:999px;padding:6px 10px;font-weight:900;white-space:nowrap;margin-top:0!important}.doc-item small{display:block;color:#98a2b3;margin-top:4px;font-size:12px;word-break:break-all}.doc-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end}.open-doc{border:1px solid #f97316;background:white;color:#f97316;border-radius:999px;padding:7px 12px;font-weight:900;cursor:pointer}.open-doc:hover{background:#fff7ed}@media(max-width:1050px){.stats,.columns,.grid{grid-template-columns:1fr}.sidebar{width:230px}.row{grid-template-columns:1fr}.head{display:none}}@media(max-width:780px){.app{flex-direction:column}.sidebar{width:100%}.sidebar nav{grid-template-columns:repeat(2,1fr)}.content{padding:20px}.topbar{padding:14px 20px;align-items:flex-start;flex-direction:column}.topbar-actions{width:100%;justify-content:space-between;flex-wrap:wrap}.quick{grid-template-columns:1fr}.hero{align-items:flex-start;flex-direction:column}.right,.doc-item{flex-direction:column}.doc-actions{align-items:flex-start;justify-content:flex-start}.right button{width:100%}}
`;
