import { useState } from "react";
import { useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Mail,
  Phone,
  MapPin,
  Send,
  MessageSquare,
  Clock,
  Check,
  Headphones,
  MessageCircle,
} from "lucide-react";
import { Button, SectionHeader } from "../components/UI";

export default function Contact() {
  const location = useLocation();
  const state = location.state as { message?: string } | null;
  const [sent, setSent] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    company: "",
    topic: "sales",
    message: state?.message || "",
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSent(true);
    setTimeout(() => setSent(false), 4000);
    setForm({ name: "", email: "", company: "", topic: "sales", message: "" });
  };

  return (
    <main className="py-12">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <SectionHeader
          eyebrow="Get in touch"
          title={
            <>
              Let's <span className="grad-text">build together</span>
            </>
          }
          subtitle="Have a question or need help with your order? Our team is here for you 24/7."
          align="center"
        />

        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: Mail, title: "Email", val: "contact@zolopacking.com", sub: "Reply in 4 hours", color: "from-brand-500 to-amber-400" },
            { icon: Phone, title: "Phone", val: "+91 9582712626", sub: "Mon–Fri 9am–6pm PT", color: "from-emerald-500 to-teal-500" },
            { icon: MapPin, title: "Studio", val: "Ground Floor 365, Lotus Mall, Sultanpur", sub: "New Delhi - 110030", color: "from-violet-500 to-fuchsia-500" },
            { icon: Clock, title: "Live chat", val: "Available 24/7", sub: "", color: "from-amber-500 to-orange-500" },
          ].map((c) => (
            <motion.div
              key={c.title}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="bg-white rounded-2xl border border-ink-100 card-shadow p-5"
            >
              <div className={`h-11 w-11 rounded-xl bg-gradient-to-br ${c.color} flex items-center justify-center mb-4`}>
                <c.icon className="h-5 w-5 text-white" />
              </div>
              <div className="text-xs uppercase tracking-wider text-ink-500 font-semibold">
                {c.title}
              </div>
              <div className="font-display font-semibold mt-1">{c.val}</div>
              {c.sub && <div className="text-xs text-ink-500 mt-0.5">{c.sub}</div>}
            </motion.div>
          ))}
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-[1fr_380px]">
          <motion.form
            onSubmit={submit}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="bg-white rounded-2xl border border-ink-100 card-shadow p-6 lg:p-8"
          >
            <div className="flex items-center gap-2 mb-6">
              <MessageSquare className="h-5 w-5 text-brand-500" />
              <h2 className="font-display text-xl font-bold">Send us a message</h2>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Name"
                required
                value={form.name}
                onChange={(v) => setForm({ ...form, name: v })}
              />
              <Field
                label="Email"
                type="email"
                required
                value={form.email}
                onChange={(v) => setForm({ ...form, email: v })}
              />
              <Field
                label="Company (optional)"
                value={form.company}
                onChange={(v) => setForm({ ...form, company: v })}
              />
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-ink-500">
                  Topic
                </label>
                <select
                  value={form.topic}
                  onChange={(e) => setForm({ ...form, topic: e.target.value })}
                  className="mt-1.5 w-full px-3 py-2.5 rounded-xl border border-ink-200 text-sm focus:border-brand-400 outline-none"
                >
                  <option value="sales">Sales inquiry</option>
                  <option value="support">Order support</option>
                  <option value="enterprise">Enterprise</option>
                  <option value="partnership">Partnership</option>
                  <option value="press">Press</option>
                </select>
              </div>
            </div>

            <div className="mt-4">
              <label className="text-xs font-semibold uppercase tracking-wider text-ink-500">
                Message
              </label>
              <textarea
                required
                rows={6}
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
                placeholder="Tell us about your project or question..."
                className="mt-1.5 w-full px-3 py-2.5 rounded-xl border border-ink-200 text-sm focus:border-brand-400 outline-none resize-none"
              />
            </div>

            <div className="mt-6 flex items-center justify-between flex-wrap gap-3">
              <div className="text-xs text-ink-500">
                We respect your privacy. Your information is never shared.
              </div>
              <Button type="submit" size="lg">
                {sent ? (
                  <>
                    <Check className="h-4 w-4" /> Sent!
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" /> Send message
                  </>
                )}
              </Button>
            </div>
          </motion.form>

          <div className="space-y-4">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="bg-gradient-to-br from-ink-900 via-ink-800 to-ink-900 rounded-2xl p-6 text-white relative overflow-hidden"
            >
              <div className="absolute inset-0 grid-bg-light opacity-20" />
              <div className="absolute -top-24 -right-24 w-64 h-64 rounded-full bg-brand-500/30 blur-3xl" />
              <div className="relative">
                <Headphones className="h-6 w-6 text-brand-400 mb-3" />
                <h3 className="font-display text-lg font-bold">Need immediate help?</h3>
                <p className="text-sm text-ink-300 mt-2 leading-relaxed">
                  Chat with our packaging experts right now. No bots, no wait times.
                </p>
                <a
                  href="#"
                  className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm font-semibold transition-colors"
                >
                  <MessageCircle className="h-4 w-4" />
                  Start live chat
                </a>
              </div>
            </motion.div>

            <div className="bg-white rounded-2xl border border-ink-100 card-shadow p-6">
              <h3 className="font-display font-bold mb-4">FAQ</h3>
              <div className="space-y-3">
                {[
                  { q: "What are your minimum order quantities?", a: "MOQs start at 10 units for most products." },
                  { q: "Do you ship internationally?", a: "Yes — to 180+ countries with tracked shipping." },
                  { q: "Can I get a sample before ordering?", a: "Free samples available on orders over ₹500." },
                ].map((f) => (
                  <details key={f.q} className="group border-b border-ink-100 last:border-0 pb-3 last:pb-0">
                    <summary className="text-sm font-semibold cursor-pointer flex items-center justify-between">
                      {f.q}
                      <span className="text-ink-400 group-open:rotate-45 transition-transform">+</span>
                    </summary>
                    <p className="mt-2 text-xs text-ink-600 leading-relaxed">{f.a}</p>
                  </details>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="text-xs font-semibold uppercase tracking-wider text-ink-500">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="mt-1.5 w-full px-3 py-2.5 rounded-xl border border-ink-200 text-sm focus:border-brand-400 outline-none"
      />
    </div>
  );
}
