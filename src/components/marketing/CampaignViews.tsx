// Presentational campaign components. They take a campaign object and render
// it — no fetching, no storage — so the storefront and the admin "Preview"
// modal draw the SAME markup.
//
// Every value is printed as a React text node (never dangerouslySetInnerHTML),
// so campaign content cannot inject markup. Uploaded images are boxed with
// fixed aspect ratios / max heights + object-cover, so an oddly sized upload can
// never push the layout around.
//
// Visual frame = the storefront design system (12px radius, dark-200 borders,
// navy/green/cream surfaces, btn-* CTAs). Only the campaign's own image and
// text vary — never the colours.
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Megaphone, Quote, X } from "lucide-react";
import type { PublicCampaign } from "@/lib/api/marketing";
import { cn } from "@/utils/cn";

export type CampaignLike = Pick<
  PublicCampaign,
  | "id" | "contentType" | "title" | "subtitle" | "description" | "quote" | "quoteAuthor"
  | "imageUrl" | "mobileImageUrl" | "imageAlt" | "badgeText" | "buttonText" | "buttonLink" | "buttonExternal"
>;

// ---------- building blocks ----------

/** Desktop image with an optional mobile variant (falls back to desktop). */
export function CampaignImage({ campaign, className }: { campaign: CampaignLike; className?: string }) {
  if (!campaign.imageUrl) return null;
  return (
    <picture>
      {campaign.mobileImageUrl && <source media="(max-width: 639px)" srcSet={campaign.mobileImageUrl} />}
      <img
        src={campaign.imageUrl}
        alt={campaign.imageAlt ?? campaign.title ?? ""}
        loading="lazy"
        decoding="async"
        className={cn("block h-full w-full object-cover", className)}
      />
    </picture>
  );
}

/** Internal destinations route in-app; external ones open safely in a new tab. */
export function CampaignLink({
  campaign, className, children, onNavigate,
}: { campaign: CampaignLike; className?: string; children: ReactNode; onNavigate?: () => void }) {
  if (!campaign.buttonLink) return null;
  if (campaign.buttonExternal) {
    return (
      <a href={campaign.buttonLink} target="_blank" rel="noopener noreferrer" className={className} onClick={onNavigate}>
        {children}
      </a>
    );
  }
  return <Link to={campaign.buttonLink} className={className} onClick={onNavigate}>{children}</Link>;
}

type CtaVariant = "primary" | "secondary" | "green" | "white";
const CTA_CLASS: Record<CtaVariant, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  green: "btn-green",
  white: "btn-white",
};

function CtaButton({ campaign, variant = "primary", size = "md", onNavigate }: {
  campaign: CampaignLike; variant?: CtaVariant; size?: "sm" | "md"; onNavigate?: () => void;
}) {
  if (!campaign.buttonLink || !campaign.buttonText) return null;
  return (
    <CampaignLink
      campaign={campaign}
      onNavigate={onNavigate}
      className={cn("btn max-w-full", CTA_CLASS[variant], size === "sm" && "btn-sm")}
    >
      <span className="truncate">{campaign.buttonText}</span>
      <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
    </CampaignLink>
  );
}

const Badge = ({ text, className }: { text: string | null; className?: string }) =>
  text ? (
    <span className={cn("badge max-w-full bg-green-500 text-white", className)}>
      <span className="truncate">{text}</span>
    </span>
  ) : null;

/** The text stack shared by banner / card / popup. Quote campaigns swap in the quote. */
function CampaignCopy({ campaign, invert, compact }: { campaign: CampaignLike; invert?: boolean; compact?: boolean }) {
  const muted = invert ? "text-white/75" : "text-dark-500";
  const strong = invert ? "text-white" : "text-dark-900";
  const accent = invert ? "text-green-300" : "text-green-500";
  if (campaign.contentType === "quote") {
    return (
      <figure className="min-w-0">
        <Quote className={cn("mb-2 h-6 w-6", accent)} aria-hidden />
        <blockquote className={cn("font-display font-bold leading-snug break-words", strong, compact ? "text-lg" : "text-xl sm:text-2xl")}>
          {campaign.quote}
        </blockquote>
        {campaign.quoteAuthor && <figcaption className={cn("mt-2 text-sm font-semibold", muted)}>— {campaign.quoteAuthor}</figcaption>}
      </figure>
    );
  }
  return (
    <div className="min-w-0">
      {campaign.subtitle && (
        <div className={cn("mb-1.5 text-xs font-bold uppercase tracking-[0.18em] break-words", accent)}>
          {campaign.subtitle}
        </div>
      )}
      {campaign.title && (
        <h3 className={cn("font-display font-bold leading-tight tracking-[-0.01em] break-words", strong, compact ? "text-lg sm:text-xl" : "text-2xl sm:text-3xl")}>
          {campaign.title}
        </h3>
      )}
      {campaign.description && (
        <p className={cn("mt-2 whitespace-pre-line break-words leading-relaxed", muted, compact ? "text-sm" : "text-sm sm:text-[15px]")}>{campaign.description}</p>
      )}
    </div>
  );
}

/** One line of text for the bars/strips, whatever the content type. */
const headline = (c: CampaignLike) => c.title ?? c.quote ?? c.description ?? c.imageAlt ?? "";
const subline = (c: CampaignLike) => (c.title ? c.subtitle ?? c.description : c.quote ? c.quoteAuthor : null);

// ---------- Announcement bar ----------
// Rendered inside the navy top bar (App.tsx TopBar), so this is the inner
// text-xs line only.

export function AnnouncementView({ campaign, onNavigate }: { campaign: CampaignLike; onNavigate?: () => void }) {
  return (
    <div className="flex min-w-0 items-center justify-center gap-2 text-xs text-white sm:justify-start" role="status">
      <Megaphone className="h-3.5 w-3.5 shrink-0 text-green-400" aria-hidden />
      <span className="min-w-0 truncate">
        <span className="font-semibold">{headline(campaign)}</span>
        {subline(campaign) && <span className="hidden text-white/70 md:inline"> — {subline(campaign)}</span>}
      </span>
      {campaign.buttonLink && campaign.buttonText && (
        <CampaignLink campaign={campaign} onNavigate={onNavigate} className="shrink-0 font-bold text-green-400 underline-offset-2 hover:underline">
          {campaign.buttonText}
        </CampaignLink>
      )}
    </div>
  );
}

// ---------- Homepage banner (hero placement) ----------

export function CampaignBannerView({ campaign, onNavigate }: { campaign: CampaignLike; onNavigate?: () => void }) {
  // Image-only: the artwork IS the banner. The whole image is the link.
  if (campaign.contentType === "image") {
    const img = (
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[12px] border border-dark-200 bg-dark-100 shadow-card sm:aspect-[21/7]">
        <CampaignImage campaign={campaign} />
        {campaign.buttonLink && campaign.buttonText && (
          <span className="btn btn-white btn-sm absolute bottom-4 left-4 shadow-card">
            {campaign.buttonText} <ArrowRight className="h-4 w-4" aria-hidden />
          </span>
        )}
      </div>
    );
    return campaign.buttonLink ? <CampaignLink campaign={campaign} onNavigate={onNavigate} className="block">{img}</CampaignLink> : img;
  }

  const hasImage = Boolean(campaign.imageUrl);
  return (
    <div className="relative overflow-hidden rounded-[12px] border border-white/10 bg-navy-900 text-white shadow-card">
      <div className={cn("grid items-stretch", hasImage && "md:grid-cols-2")}>
        <div className="flex flex-col items-start justify-center gap-4 p-5 sm:p-8">
          <Badge text={campaign.badgeText} />
          <CampaignCopy campaign={campaign} invert />
          <CtaButton campaign={campaign} variant="primary" size="sm" onNavigate={onNavigate} />
        </div>
        {hasImage && (
          <div className="relative order-first aspect-[16/9] w-full overflow-hidden md:order-none md:aspect-auto md:min-h-[260px] md:max-h-[360px]">
            <CampaignImage campaign={campaign} className="md:absolute md:inset-0" />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Promotional card ----------

export function PromotionCardView({ campaign, onNavigate }: { campaign: CampaignLike; onNavigate?: () => void }) {
  const hasImage = Boolean(campaign.imageUrl);
  return (
    <article className="group card card-hover flex h-full min-w-0 flex-col overflow-hidden">
      {hasImage && (
        <div className="relative aspect-[16/9] w-full overflow-hidden bg-green-50">
          <CampaignImage campaign={campaign} className="transition-transform duration-200 group-hover:scale-[1.03]" />
          <Badge text={campaign.badgeText} className="absolute left-3 top-3 shadow-sm" />
        </div>
      )}
      {campaign.contentType !== "image" && (
        <div className="flex flex-1 flex-col items-start gap-3 p-5">
          {!hasImage && <Badge text={campaign.badgeText} />}
          <CampaignCopy campaign={campaign} compact />
          <div className="mt-auto pt-1"><CtaButton campaign={campaign} variant="secondary" size="sm" onNavigate={onNavigate} /></div>
        </div>
      )}
      {campaign.contentType === "image" && campaign.buttonLink && campaign.buttonText && (
        <div className="p-4"><CtaButton campaign={campaign} variant="secondary" size="sm" onNavigate={onNavigate} /></div>
      )}
    </article>
  );
}

// ---------- Inline strip (listing / product / cart / checkout) ----------

export function CampaignStripView({ campaign, onNavigate }: { campaign: CampaignLike; onNavigate?: () => void }) {
  return (
    <aside className="flex min-w-0 flex-col gap-3 overflow-hidden rounded-[12px] border border-green-200 bg-green-50 px-4 py-3 sm:flex-row sm:items-center sm:gap-4" aria-label="Promotion">
      {campaign.imageUrl && (
        <div className="h-28 w-full shrink-0 overflow-hidden rounded-lg border border-green-200 bg-white sm:h-14 sm:w-20">
          <CampaignImage campaign={campaign} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {campaign.badgeText && <Badge text={campaign.badgeText} />}
          <span className="min-w-0 break-words text-sm font-bold text-green-800">{headline(campaign)}</span>
        </div>
        {subline(campaign) && <p className="mt-0.5 line-clamp-2 break-words text-xs text-green-700">{subline(campaign)}</p>}
      </div>
      <div className="shrink-0"><CtaButton campaign={campaign} variant="green" size="sm" onNavigate={onNavigate} /></div>
    </aside>
  );
}

// ---------- Popup ----------

const POPUP_POSITION: Record<PublicCampaign["popup"]["position"], string> = {
  center: "items-center justify-center",
  bottom_right: "items-end justify-center sm:justify-end",
  bottom_left: "items-end justify-center sm:justify-start",
};

/**
 * The popup frame. `contained` renders it inside a box (admin preview) instead
 * of over the whole viewport. A dimming overlay is only drawn when the popup
 * can be closed — an unclosable popup never blocks the page behind it.
 */
export function CampaignPopupView({
  campaign, popup, onClose, onNavigate, contained,
}: {
  campaign: CampaignLike;
  popup: PublicCampaign["popup"];
  onClose: () => void;
  onNavigate?: () => void;
  contained?: boolean;
}) {
  const overlay = popup.overlay && popup.allowClose;
  const center = popup.position === "center";
  return (
    <div
      className={cn(
        contained ? "absolute" : "fixed",
        "inset-0 z-[70] flex p-4 sm:p-6",
        POPUP_POSITION[popup.position],
        !overlay && "pointer-events-none",
      )}
    >
      {overlay && <div className="absolute inset-0 bg-navy-950/55" onClick={onClose} aria-hidden />}
      <div
        role="dialog"
        aria-modal={overlay}
        aria-label={campaign.title ?? campaign.quote ?? "Promotion"}
        className={cn(
          "card pointer-events-auto relative flex max-h-full w-full flex-col overflow-hidden rounded-[12px] shadow-card-hover",
          center ? "max-w-md" : "max-w-sm",
        )}
      >
        {popup.allowClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close promotion"
            className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-dark-200 bg-white text-dark-700 transition-colors hover:bg-dark-50"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
        {campaign.imageUrl && (
          <div className={cn("relative w-full shrink-0 overflow-hidden bg-green-50", center ? "aspect-[16/10]" : "aspect-[16/8]")}>
            <CampaignImage campaign={campaign} />
            <Badge text={campaign.badgeText} className="absolute left-3 top-3 shadow-sm" />
          </div>
        )}
        {campaign.contentType !== "image" ? (
          <div className="flex flex-col items-start gap-4 overflow-y-auto p-5">
            {!campaign.imageUrl && <Badge text={campaign.badgeText} />}
            <CampaignCopy campaign={campaign} compact />
            <CtaButton campaign={campaign} variant="primary" onNavigate={onNavigate} />
          </div>
        ) : (
          campaign.buttonLink && campaign.buttonText && <div className="p-4"><CtaButton campaign={campaign} variant="primary" onNavigate={onNavigate} /></div>
        )}
      </div>
    </div>
  );
}
