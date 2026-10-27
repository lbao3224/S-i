import { z } from "zod";

const money = z.number().finite().nonnegative();
const id = z.string().min(1).max(120);

const productSchema = z.object({
  id,
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(80),
  unit: z.string().trim().min(1).max(30),
  price: money,
  cost: money,
  stock: z.number().finite(),
  lowStock: z.number().finite().nonnegative(),
  active: z.boolean(),
});

const customerSchema = z.object({
  id,
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(30).optional(),
});

const cartItemSchema = productSchema.pick({ id: true, name: true, unit: true, price: true, cost: true }).extend({
  quantity: z.number().int().positive(),
});

const orderSchema = z.object({
  id,
  number: z.string().min(1).max(80),
  createdAt: z.string().datetime(),
  customerId: id.optional(),
  customerName: z.string().trim().min(1).max(120),
  items: z.array(cartItemSchema).min(1),
  subtotal: money,
  discount: money,
  total: money,
  paid: money,
  method: z.enum(["cash", "transfer", "debt"]),
});

const cashEntrySchema = z.object({
  id,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type: z.enum(["income", "expense"]),
  category: z.string().trim().min(1).max(100),
  note: z.string().trim().max(500),
  amount: money,
});

const debtEntrySchema = z.object({
  id,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  customerId: id.optional(),
  customerName: z.string().trim().min(1).max(120),
  type: z.enum(["debt", "payment"]),
  amount: money,
  note: z.string().trim().max(500),
});

export const ledgerDatabaseSchema = z.object({
  store: z.object({
    name: z.string().trim().min(1).max(120),
    allowNegativeStock: z.boolean(),
    bankName: z.string().trim().max(100).optional(),
    bankBin: z.string().trim().max(20).optional(),
    bankAccount: z.string().trim().max(30).optional(),
    bankOwner: z.string().trim().max(120).optional(),
    voiceAnnouncement: z.boolean().optional(),
    phowhisperModel: z.string().trim().max(120).optional(),
    hfToken: z.string().trim().max(200).optional(),
    phowhisperEndpoint: z.string().trim().max(300).optional(),
  }),
  products: z.array(productSchema).max(10_000),
  customers: z.array(customerSchema).max(50_000),
  orders: z.array(orderSchema).max(100_000),
  cashEntries: z.array(cashEntrySchema).max(100_000),
  debtEntries: z.array(debtEntrySchema).max(100_000).default([]),
});
