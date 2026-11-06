// Seeds the eight AdSens services from the brief as real, admin-editable rows.
// Idempotent: upsert by slug, so re-running never duplicates or overwrites an
// admin's later edits to isActive/sortOrder.
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

const SERVICES = [
  ["digital-advertising", "Digital Advertising", "Google, Meta, YouTube and LinkedIn campaigns managed end to end.",
    ["Google Ads", "Meta Ads (Facebook & Instagram)", "YouTube Advertising", "LinkedIn Advertising", "Campaign management", "Retargeting campaigns"]],
  ["social-media-marketing", "Social Media Marketing", "Day-to-day management and growth of your social channels.",
    ["Instagram management", "Facebook management", "Content planning", "Social media strategy", "Audience engagement", "Brand growth"]],
  ["seo", "Search Engine Optimization", "Get found when customers search for what you sell.",
    ["Technical SEO", "On-page SEO", "Off-page SEO", "Keyword research", "Local SEO", "Website optimization"]],
  ["website-development", "Website & Landing Pages", "Sites and pages built to turn visitors into enquiries.",
    ["Business websites", "E-commerce websites", "Landing pages", "Lead generation pages", "Conversion optimization"]],
  ["creative-content", "Creative & Content Production", "The creatives your campaigns run on.",
    ["Social media creatives", "Advertising banners", "Product photography", "Promotional videos", "Reels & short-form video", "Brand identity creatives"]],
  ["lead-generation", "Lead Generation", "Campaigns and funnels built to bring enquiries to your business.",
    ["Qualified lead campaigns", "Lead forms", "WhatsApp lead generation", "Landing page funnels", "Campaign optimization"]],
  ["whatsapp-marketing", "WhatsApp & Business Marketing", "Reach and follow up with customers where they already are.",
    ["WhatsApp Business setup", "Customer communication automation", "Promotional campaigns with consent", "Lead follow-up workflows", "Customer retention campaigns"]],
  ["marketing-strategy", "Marketing Strategy & Consulting", "A plan before the spend.",
    ["Business growth strategy", "Competitor research", "Target audience research", "Marketing budget planning", "Campaign performance analysis"]],
];

let n = 0;
for (const [slug, name, summary, deliverables] of SERVICES) {
  await p.marketingService.upsert({
    where: { slug },
    update: { name, summary, deliverables },           // never touches isActive/sortOrder
    create: { slug, name, summary, deliverables, isActive: true, sortOrder: ++n },
  });
}
console.log("services:", await p.marketingService.count());
await p.$disconnect();
