// ===========================================================================
// Sales & Financial Details — the operational report, one row per order LINE.
//
// THE REPORTING CONVENTION (the brief asks for this to be explicit):
//
// An order with three products becomes three rows sharing one Order ID. Line
// figures — Qty, Rate, Sale, Cost, Profit — are per line and sum correctly.
// Order-level figures — Amount Received, Balance — belong to the ORDER, not to
// any one line, so repeating them on all three rows and summing the column
// would count the same money three times.
//
// So they are attributed to the FIRST line of each order and left blank on the
// rest. Blank means "see the first row of this order", never "zero". A reader
// scanning the sheet sees the receipt once; a SUM() over the column gives the
// true total; and nothing is invented to fill a gap.
//
// Where an apportioned figure is genuinely wanted (per-line share of a part
// payment), `receivedShareMinor` carries it, computed pro-rata on line value
// with the rounding remainder pushed onto the last line so the shares add back
// to the exact receipt. Both are exported; the sheet uses the attributed one.
//
// Every figure is read from the database at request time. Nothing is cached,
// estimated or defaulted to zero when unknown — a missing cost yields a blank
// Profit, not a profit equal to the full sale.
// ===========================================================================
import { prisma } from "../lib/prisma.mjs";

/** Cancelled orders are excluded from money totals everywhere else too. */
const LIVE_ORDER = { status: { notIn: ["CANCELLED"] } };

const PAGE_MAX = 500;
const EXPORT_MAX = 50_000;

const nameOf = (u) =>
  u ? u.company || [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email : null;

/**
 * Collection status, derived — never stored.
 *
 * It is a function of money AND the clock, so storing it would be wrong the
 * next morning. Mirrors crm.derivePaymentState so the report and the CRM
 * cannot disagree.
 */
function collectionStatus(order, now) {
  const outstanding = Math.max(0, order.grandTotalMinor - order.paidMinor);
  if (outstanding === 0) return "Collected";
  if (order.dueDate && new Date(order.dueDate) < now) return "Overdue";
  if (order.paidMinor > 0) return "Part collected";
  return "Pending";
}

/**
 * Build the WHERE clause shared by the paged report and the export, so the
 * spreadsheet can never contain a different set of rows from the screen that
 * produced it.
 */
function buildWhere(q = {}) {
  const where = { order: { ...LIVE_ORDER } };

  if (q.from || q.to) {
    where.order.placedAt = {
      ...(q.from ? { gte: new Date(q.from) } : {}),
      ...(q.to ? { lt: new Date(q.to) } : {}),
    };
  }
  if (q.salespersonId) where.order.salespersonId = String(q.salespersonId);
  if (q.customerId) where.order.userId = String(q.customerId);
  if (q.status) where.order.status = String(q.status);
  if (q.paymentMode) where.order.paymentMethod = String(q.paymentMode);

  // Payment state maps onto the stored paymentStatus; "overdue" additionally
  // needs the clock, so it is applied as a date predicate rather than a status.
  if (q.collection === "paid") where.order.paymentStatus = { in: ["PAID", "SUCCESS"] };
  if (q.collection === "partial") where.order.paymentStatus = "PARTIAL";
  if (q.collection === "pending") where.order.paymentStatus = "PENDING";
  if (q.collection === "overdue") {
    where.order.paymentStatus = { in: ["PENDING", "PARTIAL"] };
    where.order.dueDate = { lt: new Date() };
  }

  const search = String(q.q ?? "").trim();
  if (search) {
    where.OR = [
      { productName: { contains: search, mode: "insensitive" } },
      { order: { orderNumber: { contains: search, mode: "insensitive" } } },
      { order: { user: { firstName: { contains: search, mode: "insensitive" } } } },
      { order: { user: { lastName: { contains: search, mode: "insensitive" } } } },
      { order: { user: { company: { contains: search, mode: "insensitive" } } } },
      { order: { user: { email: { contains: search, mode: "insensitive" } } } },
    ];
  }
  return where;
}

const SORTS = {
  date: (dir) => ({ order: { placedAt: dir } }),
  customer: (dir) => ({ order: { user: { company: dir } } }),
  sale: (dir) => ({ lineTotalMinor: dir }),
  product: (dir) => ({ productName: dir }),
};

/**
 * One row per order line, with the order's money attributed to its first line.
 *
 * @param {object} q  filters + paging; `all: true` ignores paging for export.
 */
export async function salesFinancialReport(q = {}) {
  const now = new Date();
  const where = buildWhere(q);

  const exportAll = q.all === true || q.all === "1" || q.all === "true";
  const limit = exportAll ? EXPORT_MAX : Math.min(PAGE_MAX, Math.max(1, Number(q.limit) || 50));
  const page = Math.max(1, Number(q.page) || 1);

  const dir = q.dir === "asc" ? "asc" : "desc";
  const orderBy = [(SORTS[q.sort] ?? SORTS.date)(dir), { orderId: "asc" }, { id: "asc" }];

  const [total, items] = await Promise.all([
    prisma.orderItem.count({ where }),
    prisma.orderItem.findMany({
      where,
      orderBy,
      skip: exportAll ? 0 : (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        orderId: true,
        productName: true,
        quantity: true,
        unitPriceMinor: true,
        unitCostMinor: true,
        lineTotalMinor: true,
        order: {
          select: {
            id: true,
            orderNumber: true,
            placedAt: true,
            expectedDeliveryDate: true,
            status: true,
            paymentStatus: true,
            paymentMethod: true,
            grandTotalMinor: true,
            paidMinor: true,
            dueDate: true,
            notes: true,
            user: { select: { id: true, firstName: true, lastName: true, company: true, email: true } },
            salesperson: { select: { id: true, firstName: true, lastName: true, email: true } },
            payments: {
              where: { status: { in: ["PAID", "SUCCESS"] } },
              orderBy: { paidAt: "asc" },
              select: { method: true, paidAt: true, receivedBy: { select: { firstName: true, lastName: true, email: true } } },
            },
            shipments: { where: { deliveredAt: { not: null } }, orderBy: { deliveredAt: "desc" }, take: 1, select: { deliveredAt: true } },
          },
        },
      },
    }),
  ]);

  // Which line carries each order's order-level money. The first line IN THIS
  // RESULT SET: on a paged view the first line of an order may be on an
  // earlier page, and attributing to an absent row would drop the receipt from
  // the page entirely.
  const firstLineOfOrder = new Map();
  for (const it of items) if (!firstLineOfOrder.has(it.orderId)) firstLineOfOrder.set(it.orderId, it.id);

  // Pro-rata shares, computed per order over the lines present, with the
  // remainder on the last line so the shares sum to the exact receipt.
  const linesByOrder = new Map();
  for (const it of items) {
    if (!linesByOrder.has(it.orderId)) linesByOrder.set(it.orderId, []);
    linesByOrder.get(it.orderId).push(it);
  }
  const shareById = new Map();
  for (const [, lines] of linesByOrder) {
    const o = lines[0].order;
    const base = lines.reduce((s, l) => s + l.lineTotalMinor, 0);
    let allocated = 0;
    lines.forEach((l, i) => {
      const share =
        i === lines.length - 1
          ? o.paidMinor - allocated
          : base > 0
            ? Math.round((l.lineTotalMinor / base) * o.paidMinor)
            : 0;
      allocated += share;
      shareById.set(l.id, Math.max(0, share));
    });
  }

  const rows = items.map((it) => {
    const o = it.order;
    const isFirst = firstLineOfOrder.get(it.orderId) === it.id;
    const lastPayment = o.payments.at(-1) ?? null;
    // Cost is nullable by design: null means "not recorded", which is not zero.
    const lineCostMinor = it.unitCostMinor == null ? null : it.unitCostMinor * it.quantity;

    return {
      // 1-2 customer
      customerId: o.user?.id ?? null,
      customerName: nameOf(o.user) ?? "—",
      // 3-4 order
      orderId: o.id,
      orderNumber: o.orderNumber,
      orderDate: o.placedAt,
      // 5-8 line
      productName: it.productName,
      quantity: it.quantity,
      rateMinor: it.unitPriceMinor,
      saleMinor: it.lineTotalMinor,
      // 9 cost (null when never recorded)
      costMinor: lineCostMinor,
      // 10-11 ORDER-level money, only on the order's first row in this result
      receivedMinor: isFirst ? o.paidMinor : null,
      balanceMinor: isFirst ? Math.max(0, o.grandTotalMinor - o.paidMinor) : null,
      orderTotalMinor: isFirst ? o.grandTotalMinor : null,
      // Apportioned alternative, for anyone who needs a per-line split.
      receivedShareMinor: shareById.get(it.id) ?? 0,
      // 12-13 payment
      paymentMode: lastPayment?.method ?? (o.paidMinor > 0 ? o.paymentMethod : null),
      paymentReceivedBy: lastPayment?.receivedBy
        ? [lastPayment.receivedBy.firstName, lastPayment.receivedBy.lastName].filter(Boolean).join(" ") ||
          lastPayment.receivedBy.email
        : null,
      // 14 profit — blank, never zero, when cost is unknown
      profitMinor: lineCostMinor == null ? null : it.lineTotalMinor - lineCostMinor,
      // 15 delivery: the real delivered date when shipped, else the promise
      deliveryDate: o.shipments[0]?.deliveredAt ?? o.expectedDeliveryDate ?? null,
      deliveredActual: Boolean(o.shipments[0]?.deliveredAt) || o.status === "DELIVERED",
      // 16-19
      salespersonId: o.salesperson?.id ?? null,
      salesperson: o.salesperson
        ? [o.salesperson.firstName, o.salesperson.lastName].filter(Boolean).join(" ") || o.salesperson.email
        : null,
      orderStatus: o.status,
      remarks: o.notes ?? null,
      collectionStatus: collectionStatus(o, now),
      isFirstLineOfOrder: isFirst,
    };
  });

  return {
    rows,
    total,
    page: exportAll ? 1 : page,
    limit,
    pages: exportAll ? 1 : Math.max(1, Math.ceil(total / limit)),
    truncated: exportAll && total > EXPORT_MAX,
    convention:
      "One row per order line. Qty/Rate/Sale/Cost/Profit are per line. Received and Balance belong to the order and appear only on its first row; blank means 'see the first row of this order', not zero.",
  };
}

/**
 * Totals for the CURRENT FILTER, over every matching row — not just the page.
 *
 * Line money is summed over lines; order money over DISTINCT orders, which is
 * the whole reason the two are separated in the row shape above.
 */
export async function salesFinancialTotals(q = {}) {
  const where = buildWhere(q);

  const [lineAgg, lines] = await Promise.all([
    prisma.orderItem.aggregate({ where, _sum: { lineTotalMinor: true }, _count: true }),
    // Cost/profit need the nullable column, so they are summed in JS over the
    // lines that actually carry one. Coverage is reported alongside, because a
    // margin over part of the book must never read as if it covered all of it.
    prisma.orderItem.findMany({
      where,
      select: { quantity: true, unitCostMinor: true, lineTotalMinor: true, orderId: true },
    }),
  ]);

  let costMinor = 0;
  let costedRevenueMinor = 0;
  let costedLines = 0;
  const orderIds = new Set();
  for (const l of lines) {
    orderIds.add(l.orderId);
    if (l.unitCostMinor == null) continue;
    costMinor += l.unitCostMinor * l.quantity;
    costedRevenueMinor += l.lineTotalMinor;
    costedLines++;
  }

  // Order-level money, counted once per order.
  const orders = orderIds.size
    ? await prisma.order.aggregate({
        where: { id: { in: [...orderIds] } },
        _sum: { grandTotalMinor: true, paidMinor: true },
        _count: true,
      })
    : { _sum: { grandTotalMinor: 0, paidMinor: 0 }, _count: 0 };

  const orderTotalMinor = orders._sum.grandTotalMinor ?? 0;
  const receivedMinor = orders._sum.paidMinor ?? 0;

  return {
    lines: lineAgg._count ?? 0,
    orders: orders._count ?? 0,
    saleMinor: lineAgg._sum.lineTotalMinor ?? 0,
    costMinor,
    profitMinor: costedRevenueMinor - costMinor,
    costedLines,
    // How much of the filtered revenue the profit figure actually describes.
    costCoverageBps:
      (lineAgg._sum.lineTotalMinor ?? 0) > 0
        ? Math.round((costedRevenueMinor / lineAgg._sum.lineTotalMinor) * 10_000)
        : 0,
    orderTotalMinor,
    receivedMinor,
    balanceMinor: Math.max(0, orderTotalMinor - receivedMinor),
  };
}
