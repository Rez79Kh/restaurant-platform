// Response shapes of the API, as the browser sees them (dates are strings).

export type LineStatus = "SENT" | "PREPARING" | "READY" | "SERVED" | "VOID";

export type Line = {
  id: string;
  orderId: string;
  menuItemId: string;
  name: string;
  quantity: number;
  note: string | null;
  status: LineStatus;
  createdAt: string;
  updatedAt: string;
  unitPriceToman?: number;
};

export type Bill = {
  subtotalToman: number;
  discountToman: number;
  serviceChargeToman: number;
  vatToman: number;
  totalToman: number;
};

export type OrderView = {
  now: string;
  order: {
    id: string;
    tableId: string | null;
    tableLabel: string | null;
    status: "OPEN" | "SETTLED" | "VOID";
    version: number;
    discountType: "AMOUNT" | "PERCENT" | null;
    discountValue: number | null;
    discountReason: string | null;
    openedAt: string;
  };
  lines: Line[];
  bill: Bill;
};

export type OrderSummary = {
  id: string;
  tableId: string | null;
  openedAt: string;
  counts: Record<"SENT" | "PREPARING" | "READY" | "SERVED", number>;
};

export type Floor = {
  now: string;
  tables: { id: string; label: string; seats: number; order: OrderSummary | null }[];
  takeaways: OrderSummary[];
};

export type Menu = {
  categories: {
    id: string;
    name: string;
    items: { id: string; name: string; priceToman: number; isAvailable: boolean }[];
  }[];
};

export type Changes = {
  now: string;
  resync: boolean;
  orders: { id: string; status: string; version: number }[];
  lines: Line[];
};
