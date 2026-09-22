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
  ChevronDown,
  Headphones,
  MessageCircle,
} from "lucide-react";
import { Button, Field, Input, Select, Textarea, SectionHeader } from "../components/UI";

const CONTACTS = [
  { icon: Mail, title: "Email", val: "contact@zolopacking.com", sub: "Reply in 4 hours" },
  { icon: Phone, title: "Phone", val: "+91 9582712626", sub: "Mon–Fri 9am–6pm IST" },
  { icon: MapPin, title: "Studio", val: "Ground Floor 365, Lotus Mall, Sultanpur", sub: "New Delhi - 110030" },
  { icon: Clock, title: "Live chat", val: "Available 24/7", sub: "" },
];

const FAQ = [
  { q: "What are your minimum order quantities?", a: "MOQs start at 10 units for most products." },
  { q: "Do you ship internationally?", a: "Yes — to 180+ countries with tracked shipping." },
  { q: "Can I get a sample before ordering?", a: "Free samples available on orders over ₹500." },
];

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
    <main className="section-sm">
      <div className="shell">
        <SectionHeader
          eyebrow="Get in touch"
          title="Let's build together"
          subtitle="Have a question or need help with your order? Our team is here for you."
          align="center"
        />

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CONTACTS.map((c) => (
            <motion.div
              key={c.title}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.25 }}
              className="card p-5"
            >
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-green-100 text-green-600">
                <c.icon className="h-5 w-5" aria-hidden />
              </div>
              <div className="text-xs font-semibold uppercase tracking-wider text-dark-500">{c.title}</div>
              <div className="mt-1 break-words font-display font-semibold text-dark-900">{c.val}</div>
              {c.sub && <div className="mt-0.5 text-xs text-dark-500">{c.sub}</div>}
            </motion.div>
          ))}
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_380px]">
          <motion.form
            onSubmit={submit}
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.25 }}
            className="card p-5 sm:p-6"
          >
            <div className="mb-5 flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-green-500" aria-hidden />
              <h2 className="h3 text-dark-900">Send us a message</h2>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" htmlFor="contact-name" required>
                <Input id="contact-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoComplete="name" />
              </Field>
              <Field label="Email" htmlFor="contact-email" required>
                <Input id="contact-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required autoComplete="email" />
              </Field>
              <Field label="Company" htmlFor="contact-company" hint="Optional">
                <Input id="contact-company" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} autoComplete="organization" />
              </Field>
              <Field label="Topic" htmlFor="contact-topic">
                <Select id="contact-topic" value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })}>
                  <option value="sales">Sales inquiry</option>
                  <option value="support">Order support</option>
                  <option value="enterprise">Enterprise</option>
                  <option value="partnership">Partnership</option>
                  <option value="press">Press</option>
                </Select>
              </Field>
              <Field label="Message" htmlFor="contact-message" required className="sm:col-span-2">
                <Textarea
                  id="contact-message"
                  required
                  rows={6}
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                  placeholder="Tell us about your project or question..."
                />
              </Field>
            </div>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-dark-500">We respect your privacy. Your information is never shared.</p>
              <Button type="submit" variant="primary" className="w-full sm:w-auto">
                {sent ? (
                  <>
                    <Check className="h-4 w-4" aria-hidden /> Sent!
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" aria-hidden /> Send message
                  </>
                )}
              </Button>
            </div>
          </motion.form>

          <div className="space-y-4">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.25 }}
              className="rounded-[12px] bg-navy-900 p-6 text-white"
            >
              <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-green-300">
                <Headphones className="h-5 w-5" aria-hidden />
              </span>
              <h3 className="h3">Need immediate help?</h3>
              <p className="mt-2 text-sm leading-relaxed text-dark-300">
                Chat with our packaging experts right now. No bots, no wait times.
              </p>
              <a href="#" className="btn btn-white btn-sm mt-4">
                <MessageCircle className="h-4 w-4" aria-hidden />
                Start live chat
              </a>
            </motion.div>

            <div className="card p-5 sm:p-6">
              <h3 className="h3 mb-4 text-dark-900">FAQ</h3>
              <div className="space-y-2">
                {FAQ.map((f) => (
                  <details key={f.q} className="card-flat group">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-dark-900 [&::-webkit-details-marker]:hidden">
                      {f.q}
                      <ChevronDown className="h-4 w-4 shrink-0 text-dark-400 transition-transform duration-200 group-open:rotate-180" aria-hidden />
                    </summary>
                    <p className="px-4 pb-3 text-sm leading-relaxed text-dark-600">{f.a}</p>
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
