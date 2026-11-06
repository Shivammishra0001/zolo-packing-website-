import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, Briefcase, CheckCircle2, Eye, EyeOff, Pencil, Plus, Trash2 } from "lucide-react";
import { showcaseApi, type AdminCaseStudy, type CaseStudyInput } from "@/lib/api/adsens-showcase";
import { adsensApi, type AdsensService } from "@/lib/api/adsens";
import { useToast } from "@/components/ui/Toast";
import { assetUrl } from "@/lib/asset-url";
import { Badge, Button, Dialog, Select } from "../../components/ui";
import { DataTable, TableSkeleton, type Column } from "../../components/DataTable";
import { EmptyState, ErrorState } from "../../components/Panel";
import { AREA, CampaignImageField, Field, FIELD, RowActions, Section, SummaryCards, SwitchRow, errorsFrom, type FormErrors } from "./shared";

/* =========================================================
   Admin → Marketing → AdSens portfolio.

   These rows are the "Our Portfolio" grid and the case-study dialog on
   /adsens. The filter chips on that page are built from the categories
   actually used here, so adding a category here is how a new filter appears.

   THE VERIFICATION RULE: `results` are published ONLY when "results
   verified" is on. The server strips unverified results before sending
   anything to the public page, so an unverified figure cannot leak even if
   the frontend asked for it. The switch below says so in as many words,
   because an admin ticking it is making a claim on the company's behalf.
   ========================================================= */

const BLANK: CaseStudyInput = {
  title: "", clientName: "", industry: "", category: "", coverImage: null, summary: "",
  overview: "", strategy: "", execution: "", servicesProvided: [], gallery: [],
  results: [], resultsVerified: false, isPublished: false, sortOrder: 0,
};

/** One line per entry — simpler for an admin than a repeating field group,
 *  and it maps straight onto the String[] column. */
const linesToList = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
const listToLines = (a: string[]) => a.join("\n");

export default function AdsensPortfolioPage() {
  const toast = useToast();
  const [state, setState] = useState<{ status: "loading" | "error" | "success"; rows: AdminCaseStudy[]; error?: string }>({ status: "loading", rows: [] });
  const [editing, setEditing] = useState<AdminCaseStudy | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<AdminCaseStudy | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await showcaseApi.listCaseStudies();
      setState({ status: "success", rows: d.caseStudies });
    } catch (e) {
      setState((s) => ({ ...s, status: "error", error: e instanceof Error ? e.message : "Could not load the portfolio." }));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    try {
      await showcaseApi.deleteCaseStudy(deleting.id);
      toast.success(`Removed "${deleting.title}".`);
      setDeleting(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove this case study.");
    } finally { setBusy(false); }
  }

  async function togglePublish(row: AdminCaseStudy) {
    try {
      await showcaseApi.updateCaseStudy(row.id, { isPublished: !row.isPublished });
      toast.success(row.isPublished ? "Hidden from the website." : "Published to the website.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change this case study.");
    }
  }

  const rows = state.rows;
  const columns: Column<AdminCaseStudy>[] = [
    {
      key: "study",
      header: "Case study",
      render: (r) => (
        <div className="flex items-center gap-3">
          <span className="h-11 w-16 shrink-0 overflow-hidden rounded-lg erp-surface-2">
            {r.coverImage
              ? <img src={assetUrl(r.coverImage)} alt="" className="h-full w-full object-cover" />
              : <span className="grid h-full w-full place-items-center"><Briefcase className="h-4 w-4 erp-text-faint" aria-hidden /></span>}
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold erp-text">{r.title}</div>
            <div className="truncate text-xs erp-text-muted">
              {[r.clientName, r.industry].filter(Boolean).join(" · ") || "No client named"}
            </div>
          </div>
        </div>
      ),
    },
    { key: "category", header: "Category", hideBelow: "sm", render: (r) => <Badge tone="info">{r.category}</Badge> },
    {
      key: "results",
      header: "Results",
      hideBelow: "md",
      render: (r) =>
        r.results.length === 0
          ? <span className="text-xs erp-text-faint">None</span>
          : r.resultsVerified
            ? <Badge tone="success">{r.results.length} verified</Badge>
            // Stored but withheld: the admin should see that the figures they
            // entered are not reaching the website.
            : <Badge tone="warning">{r.results.length} unverified — hidden</Badge>,
    },
    {
      key: "published",
      header: "Website",
      render: (r) => (r.isPublished ? <Badge tone="success">Published</Badge> : <Badge tone="neutral">Draft</Badge>),
    },
    {
      key: "actions",
      header: "",
      className: "w-10",
      render: (r) => (
        <RowActions
          label={r.title}
          actions={[
            { label: "Edit", icon: Pencil, onClick: () => { setEditing(r); setFormOpen(true); } },
            { label: r.isPublished ? "Hide from website" : "Publish", icon: r.isPublished ? EyeOff : Eye, onClick: () => void togglePublish(r) },
            { label: "Delete", icon: Trash2, onClick: () => setDeleting(r), danger: true },
          ]}
        />
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <SummaryCards
        items={[
          { label: "Case studies", value: rows.length, icon: Briefcase },
          { label: "Published", value: rows.filter((r) => r.isPublished).length, icon: CheckCircle2, tone: "success" },
          { label: "With verified results", value: rows.filter((r) => r.resultsVerified).length, icon: BadgeCheck, tone: "info" },
        ]}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-xs erp-text-muted">
          Published case studies appear in the AdSens portfolio grid. The filter chips on that page are built from the
          categories used here, so only categories with published work are offered.
        </p>
        <Button variant="primary" icon={Plus} onClick={() => { setEditing(null); setFormOpen(true); }}>Add case study</Button>
      </div>

      {state.status === "loading" && <div className="erp-card card-shadow p-5"><TableSkeleton rows={5} /></div>}
      {state.status === "error" && <div className="erp-card card-shadow"><ErrorState message={state.error ?? "Could not load the portfolio."} onRetry={load} /></div>}

      {state.status === "success" && (
        rows.length === 0 ? (
          <div className="erp-card card-shadow">
            <EmptyState
              icon={Briefcase}
              title="No case studies yet"
              message="Add a case study to show real work on the AdSens page. The portfolio section stays hidden until one is published."
            />
          </div>
        ) : (
          <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />
        )
      )}

      <CaseStudyForm
        open={formOpen}
        study={editing}
        onClose={() => setFormOpen(false)}
        onSaved={() => { setFormOpen(false); void load(); }}
      />

      <Dialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Remove this case study?"
        description={
          deleting
            ? `"${deleting.title}" will be removed from the AdSens page. Campaign cards linked to it stay, but lose their case-study link. This cannot be undone.`
            : undefined
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="danger" loading={busy} onClick={() => void remove()}>Remove</Button>
          </>
        }
      />
    </div>
  );
}

/* ---------- the form ---------- */

function CaseStudyForm({
  open, study, onClose, onSaved,
}: {
  open: boolean;
  study: AdminCaseStudy | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<CaseStudyInput>(BLANK);
  const [services, setServices] = useState<AdsensService[]>([]);
  const [resultsText, setResultsText] = useState("");
  const [servicesText, setServicesText] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [busy, setBusy] = useState(false);

  // Service list seeds the category dropdown, so categories line up with what
  // AdSens actually sells instead of becoming free text that never matches.
  useEffect(() => { adsensApi.catalog().then((d) => setServices(d.services)).catch(() => {}); }, []);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    if (study) {
      setForm({
        title: study.title, clientName: study.clientName ?? "", industry: study.industry ?? "",
        category: study.category, coverImage: study.coverImage, summary: study.summary ?? "",
        overview: study.overview ?? "", strategy: study.strategy ?? "", execution: study.execution ?? "",
        servicesProvided: study.servicesProvided, gallery: study.gallery,
        results: study.results, resultsVerified: study.resultsVerified,
        isPublished: study.isPublished, sortOrder: study.sortOrder,
      });
      setResultsText(listToLines(study.results));
      setServicesText(listToLines(study.servicesProvided));
    } else {
      setForm(BLANK);
      setResultsText("");
      setServicesText("");
    }
  }, [open, study]);

  const set = <K extends keyof CaseStudyInput>(k: K, v: CaseStudyInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const results = linesToList(resultsText);
  const verified = form.resultsVerified === true;

  async function save() {
    if (!String(form.title ?? "").trim()) { setErrors({ title: "Give the case study a title." }); return; }
    if (!String(form.category ?? "").trim()) { setErrors({ category: "Choose a category so the portfolio filter can place it." }); return; }
    // Same rule as the server: verification is a claim about numbers, so
    // there have to be numbers.
    if (verified && results.length === 0) {
      setErrors({ results: "There are no results to verify — add them, or turn verification off." });
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      const body: CaseStudyInput = { ...form, results, servicesProvided: linesToList(servicesText) };
      if (study) await showcaseApi.updateCaseStudy(study.id, body);
      else await showcaseApi.createCaseStudy(body);
      toast.success(study ? "Case study updated." : "Case study added.");
      onSaved();
    } catch (e) {
      setErrors(errorsFrom(e, "Could not save this case study."));
    } finally { setBusy(false); }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={study ? "Edit case study" : "Add case study"}
      description="Shown in the portfolio grid on the AdSens page."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            {study ? "Save changes" : "Add case study"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {errors.form && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300">{errors.form}</p>}

        <Section title="The project">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Project title" required error={errors.title} className="sm:col-span-2">
              <input className={FIELD} value={form.title ?? ""} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Regional launch for a snacks brand" />
            </Field>
            <Field label="Client name" hint="Only publish a client's name with their permission.">
              <input className={FIELD} value={form.clientName ?? ""} onChange={(e) => set("clientName", e.target.value)} />
            </Field>
            <Field label="Industry">
              <input className={FIELD} value={form.industry ?? ""} onChange={(e) => set("industry", e.target.value)} placeholder="e.g. Food & beverage" />
            </Field>
            <Field label="Category" required error={errors.category} hint="Becomes a filter chip on the AdSens page.">
              <Select value={form.category ?? ""} onChange={(v) => set("category", v)}>
                <option value="">Choose a category…</option>
                {services.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}
                {/* An existing category that is no longer an active service
                    must still be selectable, or editing the row would silently
                    reassign it. */}
                {form.category && !services.some((s) => s.slug === form.category) && (
                  <option value={form.category}>{form.category}</option>
                )}
              </Select>
            </Field>
            <Field label="Display order" hint="Lower numbers appear first.">
              <input type="number" className={FIELD} value={form.sortOrder ?? 0} onChange={(e) => set("sortOrder", Number(e.target.value) || 0)} />
            </Field>
            <Field label="Card summary" hint="One or two lines, shown on the portfolio card." className="sm:col-span-2">
              <textarea className={AREA} value={form.summary ?? ""} onChange={(e) => set("summary", e.target.value)} />
            </Field>
            <div className="sm:col-span-2">
              <CampaignImageField
                label="Cover image"
                value={form.coverImage ?? null}
                onChange={(url) => set("coverImage", url)}
                hint="Shown on the portfolio card and at the top of the case study. Landscape images suit the 16:10 card."
              />
            </div>
          </div>
        </Section>

        <Section title="The story" hint="All optional. A short, true entry beats a padded one.">
          <Field label="Overview"><textarea className={AREA} value={form.overview ?? ""} onChange={(e) => set("overview", e.target.value)} /></Field>
          <Field label="Strategy"><textarea className={AREA} value={form.strategy ?? ""} onChange={(e) => set("strategy", e.target.value)} /></Field>
          <Field label="Execution"><textarea className={AREA} value={form.execution ?? ""} onChange={(e) => set("execution", e.target.value)} /></Field>
          <Field label="Services provided" hint="One per line.">
            <textarea className={AREA} value={servicesText} onChange={(e) => setServicesText(e.target.value)} placeholder={"Google Ads management\nCreative production"} />
          </Field>
        </Section>

        <Section
          title="Results"
          hint="One outcome per line. Nothing here reaches the website unless you verify it below."
        >
          <Field label="Outcomes" error={errors.results}>
            <textarea
              className={AREA}
              value={resultsText}
              onChange={(e) => setResultsText(e.target.value)}
              placeholder={"Cost per enquiry down 38%\n2,400 qualified enquiries in 90 days"}
            />
          </Field>
          <SwitchRow
            title="These results are verified"
            hint="Turn on only if the figures come from platform or client reporting and the client agreed to them being published. While this is off, the results above are stored but never sent to the website."
            checked={verified}
            onChange={(v) => set("resultsVerified", v)}
          />
          {results.length > 0 && !verified && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              {results.length} result{results.length === 1 ? "" : "s"} saved but hidden from the website until verified.
            </p>
          )}
        </Section>

        <Section title="Publishing">
          <SwitchRow
            title="Publish to the website"
            hint="Off keeps the case study as a draft. A campaign card linked to a draft shows no case-study link, so the visitor never hits a dead end."
            checked={form.isPublished === true}
            onChange={(v) => set("isPublished", v)}
          />
        </Section>
      </div>
    </Dialog>
  );
}
