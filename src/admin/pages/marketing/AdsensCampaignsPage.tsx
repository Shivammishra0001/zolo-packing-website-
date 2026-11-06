import { useCallback, useEffect, useState } from "react";
import { BadgeAlert, CheckCircle2, Eye, EyeOff, Megaphone, Pencil, Plus, Trash2 } from "lucide-react";
import {
  showcaseApi, PLATFORM_LABEL,
  type AdminCampaign, type AdminCaseStudy, type CampaignInput, type CampaignPlatform,
} from "@/lib/api/adsens-showcase";
import { useToast } from "@/components/ui/Toast";
import { assetUrl } from "@/lib/asset-url";
import { Badge, Button, Dialog, Select } from "../../components/ui";
import { DataTable, TableSkeleton, type Column } from "../../components/DataTable";
import { EmptyState, ErrorState } from "../../components/Panel";
import { CampaignImageField, Field, FIELD, RowActions, Section, SummaryCards, SwitchRow, errorsFrom, type FormErrors } from "./shared";

/* =========================================================
   Admin → Marketing → AdSens campaigns.

   These rows are the "Active Campaigns" rail on /adsens. Two rules are worth
   knowing before editing anything here, and the form states both inline:

   1. A card is ILLUSTRATIVE by default. An illustrative card is published as
      a design preview — the public API rewrites its status, so it can never
      show a LIVE badge, whatever is set here.
   2. Turning illustrative OFF makes the card a public claim about a real
      client, so the server requires a client name. The form asks for it
      rather than letting the save fail.
   ========================================================= */

const PLATFORMS: CampaignPlatform[] = ["meta", "google", "linkedin", "email", "youtube", "whatsapp", "other"];
const STATUSES = [
  { value: "live", label: "Live — running now" },
  { value: "completed", label: "Completed" },
  { value: "paused", label: "Paused" },
];

const BLANK: CampaignInput = {
  title: "", clientName: "", platform: "other", imageUrl: null, status: "completed",
  metric1Label: "", metric1Value: "", metric2Label: "", metric2Value: "",
  isIllustrative: true, isPublished: false, sortOrder: 0, caseStudyId: null,
};

export default function AdsensCampaignsPage() {
  const toast = useToast();
  const [state, setState] = useState<{ status: "loading" | "error" | "success"; rows: AdminCampaign[]; error?: string }>({ status: "loading", rows: [] });
  const [studies, setStudies] = useState<AdminCaseStudy[]>([]);
  const [editing, setEditing] = useState<AdminCampaign | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<AdminCampaign | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await showcaseApi.listCampaigns();
      setState({ status: "success", rows: d.campaigns });
    } catch (e) {
      setState((s) => ({ ...s, status: "error", error: e instanceof Error ? e.message : "Could not load campaigns." }));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  // The case-study list only feeds a dropdown, so a failure here must not
  // block campaign editing.
  useEffect(() => { showcaseApi.listCaseStudies().then((d) => setStudies(d.caseStudies)).catch(() => {}); }, []);

  const open = (row: AdminCampaign | null) => { setEditing(row); setFormOpen(true); };

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    try {
      await showcaseApi.deleteCampaign(deleting.id);
      toast.success(`Removed "${deleting.title}".`);
      setDeleting(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove this campaign.");
    } finally { setBusy(false); }
  }

  /** Publish toggle straight from the row — the most common single edit. */
  async function togglePublish(row: AdminCampaign) {
    try {
      await showcaseApi.updateCampaign(row.id, { isPublished: !row.isPublished });
      toast.success(row.isPublished ? "Hidden from the website." : "Published to the website.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change this campaign.");
    }
  }

  const rows = state.rows;
  const columns: Column<AdminCampaign>[] = [
    {
      key: "campaign",
      header: "Campaign",
      render: (r) => (
        <div className="flex items-center gap-3">
          <span className="h-11 w-11 shrink-0 overflow-hidden rounded-lg erp-surface-2">
            {r.imageUrl
              ? <img src={assetUrl(r.imageUrl)} alt="" className="h-full w-full object-cover" />
              : <span className="grid h-full w-full place-items-center"><Megaphone className="h-4 w-4 erp-text-faint" aria-hidden /></span>}
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold erp-text">{r.title}</div>
            <div className="truncate text-xs erp-text-muted">
              {PLATFORM_LABEL[r.platform]}{r.clientName ? ` · ${r.clientName}` : ""}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "kind",
      header: "Kind",
      hideBelow: "md",
      render: (r) =>
        r.isIllustrative
          ? <Badge tone="neutral">Illustrative</Badge>
          : <Badge tone="info">Real client</Badge>,
    },
    {
      key: "status",
      header: "Status",
      hideBelow: "sm",
      render: (r) => (
        <div className="space-y-1">
          <Badge tone={r.status === "live" && !r.isIllustrative ? "success" : "neutral"}>
            {r.status === "live" ? "Live" : r.status === "paused" ? "Paused" : "Completed"}
          </Badge>
          {/* Say it on the row, not just in the form: an admin who set
              "live" on an illustrative card should see that it has no effect. */}
          {r.status === "live" && r.isIllustrative && (
            <div className="text-[11px] erp-text-faint">Shown as illustrative</div>
          )}
        </div>
      ),
    },
    {
      key: "metrics",
      header: "Metrics",
      hideBelow: "lg",
      render: (r) => {
        const pairs = [
          r.metric1Label && r.metric1Value ? `${r.metric1Label}: ${r.metric1Value}` : null,
          r.metric2Label && r.metric2Value ? `${r.metric2Label}: ${r.metric2Value}` : null,
        ].filter(Boolean);
        return pairs.length
          ? <span className="text-xs erp-text-muted">{pairs.join(" · ")}</span>
          : <span className="text-xs erp-text-faint">—</span>;
      },
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
            { label: "Edit", icon: Pencil, onClick: () => open(r) },
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
          { label: "Campaign cards", value: rows.length, icon: Megaphone },
          { label: "Published", value: rows.filter((r) => r.isPublished).length, icon: CheckCircle2, tone: "success" },
          { label: "Real client work", value: rows.filter((r) => !r.isIllustrative).length, icon: BadgeAlert, tone: "info" },
        ]}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-xs erp-text-muted">
          These cards are the Active Campaigns rail on the AdSens page. Published cards appear in order; a card marked
          illustrative is labelled as a design preview on the website and never shows a live badge.
        </p>
        <Button variant="primary" icon={Plus} onClick={() => open(null)}>Add campaign</Button>
      </div>

      {state.status === "loading" && <div className="erp-card card-shadow p-5"><TableSkeleton rows={5} /></div>}
      {state.status === "error" && <div className="erp-card card-shadow"><ErrorState message={state.error ?? "Could not load campaigns."} onRetry={load} /></div>}

      {state.status === "success" && (
        rows.length === 0 ? (
          <div className="erp-card card-shadow">
            <EmptyState
              icon={Megaphone}
              title="No campaign cards yet"
              message="Add a card to show creative work on the AdSens page. The rail stays hidden until at least one card is published."
            />
          </div>
        ) : (
          <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />
        )
      )}

      <CampaignForm
        open={formOpen}
        campaign={editing}
        studies={studies}
        onClose={() => setFormOpen(false)}
        onSaved={() => { setFormOpen(false); void load(); }}
      />

      <Dialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Remove this campaign card?"
        description={deleting ? `"${deleting.title}" will be removed from the AdSens page. This cannot be undone.` : undefined}
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

function CampaignForm({
  open, campaign, studies, onClose, onSaved,
}: {
  open: boolean;
  campaign: AdminCampaign | null;
  studies: AdminCaseStudy[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<CampaignInput>(BLANK);
  const [errors, setErrors] = useState<FormErrors>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setForm(campaign
      ? {
          title: campaign.title, clientName: campaign.clientName ?? "", platform: campaign.platform,
          imageUrl: campaign.imageUrl, status: campaign.status,
          metric1Label: campaign.metric1Label ?? "", metric1Value: campaign.metric1Value ?? "",
          metric2Label: campaign.metric2Label ?? "", metric2Value: campaign.metric2Value ?? "",
          isIllustrative: campaign.isIllustrative, isPublished: campaign.isPublished,
          sortOrder: campaign.sortOrder, caseStudyId: campaign.caseStudyId,
        }
      : BLANK);
  }, [open, campaign]);

  const set = <K extends keyof CampaignInput>(k: K, v: CampaignInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    // Mirror the server's rule in the form so the admin is told what is
    // needed before the request, not after it comes back 400.
    if (!String(form.title ?? "").trim()) { setErrors({ title: "Give the campaign a title." }); return; }
    if (form.isIllustrative === false && !String(form.clientName ?? "").trim()) {
      setErrors({ clientName: "A real client campaign needs the client or brand name." });
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      const body: CampaignInput = { ...form, caseStudyId: form.caseStudyId || null };
      if (campaign) await showcaseApi.updateCampaign(campaign.id, body);
      else await showcaseApi.createCampaign(body);
      toast.success(campaign ? "Campaign updated." : "Campaign added.");
      onSaved();
    } catch (e) {
      setErrors(errorsFrom(e, "Could not save this campaign."));
    } finally { setBusy(false); }
  }

  const illustrative = form.isIllustrative !== false;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={campaign ? "Edit campaign card" : "Add campaign card"}
      description="Shown in the Active Campaigns rail on the AdSens page."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            {campaign ? "Save changes" : "Add campaign"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {errors.form && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300">{errors.form}</p>}

        <Section title="The card">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Campaign title" required error={errors.title} className="sm:col-span-2">
              <input className={FIELD} value={form.title ?? ""} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Festive season launch" />
            </Field>

            <Field label="Platform">
              <Select value={form.platform ?? "other"} onChange={(v) => set("platform", v as CampaignPlatform)}>
                {PLATFORMS.map((p) => <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>)}
              </Select>
            </Field>

            <Field label="Status">
              <Select value={form.status ?? "completed"} onChange={(v) => set("status", v as AdminCampaign["status"])}>
                {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </Select>
            </Field>

            <div className="sm:col-span-2">
              <CampaignImageField
                label="Creative"
                value={form.imageUrl ?? null}
                onChange={(url) => set("imageUrl", url)}
                hint="The advertisement or creative shown on the card. Portrait images suit this rail best."
              />
            </div>
          </div>
        </Section>

        <Section
          title="Is this real client work?"
          hint="This decides what the website is allowed to claim about the card."
        >
          <SwitchRow
            title="Illustrative preview"
            hint="On: the card is labelled as a design preview and can never show a live badge. Off: it is presented as real client work, so a client name is required."
            checked={illustrative}
            onChange={(v) => set("isIllustrative", v)}
          />
          <Field
            label="Client or brand name"
            required={!illustrative}
            error={errors.clientName}
            hint={illustrative ? "Leave blank on an illustrative preview — a sample card must not carry a real brand." : undefined}
          >
            <input
              className={FIELD}
              value={form.clientName ?? ""}
              onChange={(e) => set("clientName", e.target.value)}
              placeholder={illustrative ? "Not shown on illustrative cards" : "e.g. Sharma Textiles"}
            />
          </Field>
        </Section>

        <Section
          title="Performance metrics"
          hint="Optional. Both the label and the value must be filled for a metric to appear — a half-filled pair is dropped rather than shown. Only publish figures you can evidence."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Metric 1 label"><input className={FIELD} value={form.metric1Label ?? ""} onChange={(e) => set("metric1Label", e.target.value)} placeholder="e.g. Reach" /></Field>
            <Field label="Metric 1 value"><input className={FIELD} value={form.metric1Value ?? ""} onChange={(e) => set("metric1Value", e.target.value)} placeholder="e.g. 12,400" /></Field>
            <Field label="Metric 2 label"><input className={FIELD} value={form.metric2Label ?? ""} onChange={(e) => set("metric2Label", e.target.value)} placeholder="e.g. Enquiries" /></Field>
            <Field label="Metric 2 value"><input className={FIELD} value={form.metric2Value ?? ""} onChange={(e) => set("metric2Value", e.target.value)} placeholder="e.g. 186" /></Field>
          </div>
        </Section>

        <Section title="Publishing">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Linked case study" hint="Makes the card open a case study. Only published studies are linked on the website.">
              <Select value={form.caseStudyId ?? ""} onChange={(v) => set("caseStudyId", v || null)}>
                <option value="">No case study</option>
                {studies.map((s) => <option key={s.id} value={s.id}>{s.title}{s.isPublished ? "" : " (draft)"}</option>)}
              </Select>
            </Field>
            <Field label="Display order" hint="Lower numbers appear first.">
              <input type="number" className={FIELD} value={form.sortOrder ?? 0} onChange={(e) => set("sortOrder", Number(e.target.value) || 0)} />
            </Field>
          </div>
          <SwitchRow
            title="Publish to the website"
            hint="Off keeps the card as a draft, visible only here."
            checked={form.isPublished === true}
            onChange={(v) => set("isPublished", v)}
          />
        </Section>
      </div>
    </Dialog>
  );
}
