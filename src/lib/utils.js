import { format, parseISO } from 'date-fns';

export function cn(...classes) {
  return classes.filter(Boolean).join(' ');
}

export function formatDate(date, fmt = 'dd MMM yyyy') {
  if (!date) return '—';
  const d = typeof date === 'string' ? parseISO(date) : date;
  return format(d, fmt);
}

export function formatCurrency(amount) {
  if (amount == null) return '—';
  return Number(amount).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function getMonthLabel(dateStr) {
  if (!dateStr) return '';
  const d = typeof dateStr === 'string' ? parseISO(dateStr) : dateStr;
  return format(d, 'MMM-yyyy').toUpperCase();
}

export function generateId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// Fuzzy-match a raw bank description against the supplier→category map.
// Normalises both sides (lowercase, strip digits + punctuation) and checks
// whether any known supplier name is a substring of the description.
// Returns the best-matching category string, or '' if nothing matches.
export function fuzzyMatchCategory(description, supplierMap) {
  if (!description || !supplierMap || Object.keys(supplierMap).length === 0) return '';

  const normalize = (s) =>
    s.toLowerCase()
      .replace(/\d+/g, '')
      .replace(/[^a-z\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  const normDesc = normalize(description);

  // Exact lowercase match wins immediately
  if (supplierMap[description.toLowerCase()]) return supplierMap[description.toLowerCase()];

  // Partial: prefer the longest matching supplier name found inside the description
  let bestCategory = '';
  let bestLen = 0;

  for (const [supplier, category] of Object.entries(supplierMap)) {
    const normSupplier = normalize(supplier);
    if (normSupplier.length < 3) continue;
    if (normDesc.includes(normSupplier) && normSupplier.length > bestLen) {
      bestCategory = category;
      bestLen = normSupplier.length;
    }
  }

  return bestCategory;
}

export const DEFAULT_CATEGORIES = [
  'Cost of Goods Sold (COGS)',
  'Repairs & Maintenance',
  'Utilities',
  'Salaries & Wages',
  'Rent & Rates',
  'Insurance',
  'Marketing & Advertising',
  'Bank Charges',
  'Office Supplies',
  'Cleaning Supplies',
  'Entertainment',
  'Licenses & Permits',
  'Depreciation',
  'Miscellaneous',
  'Revenue — Bar Sales',
  'Revenue — Food Sales',
  'Revenue — Events',
  'Revenue — Other',
];
