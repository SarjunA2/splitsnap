export interface LineItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

export interface ReceiptData {
  items: LineItem[];
  subtotal: number;
  tax: number;
  tip: number;
  total: number;
  currency: string;
  restaurantName?: string;
  date?: string;
}

export interface Person {
  id: string;
  name: string;
  color: string;
}

export interface ItemAssignment {
  itemId: string;
  personIds: string[]; // supports shared items
}

export interface PersonSplit {
  personId: string;
  personName: string;
  items: { name: string; price: number; share: number }[];
  subtotal: number;
  taxShare: number;
  tipShare: number;
  total: number;
}

export interface SplitResult {
  splits: PersonSplit[];
  totalAccountedFor: number;
  receiptTotal: number;
}
