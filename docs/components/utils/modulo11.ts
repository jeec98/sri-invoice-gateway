export interface Modulo11BreakdownRow {
  position: number;
  digit: number;
  weight: number;
  product: number;
}

export interface Modulo11CalculationResult {
  isValid: boolean;
  input: string;
  cleanInput: string;
  is48Digits: boolean;
  is49Digits: boolean;
  computedCheckDigit: number;
  providedCheckDigit?: number;
  fullAccessKey: string;
  sum: number;
  remainder: number;
  breakdown: Modulo11BreakdownRow[];
  errorMessage?: string;
}

const WEIGHTS = [2, 3, 4, 5, 6, 7];

export function calculateModulo11(digits48: string): Modulo11CalculationResult {
  const cleanInput = (digits48 || '').trim();

  // Validate non-numeric characters
  if (!/^\d*$/.test(cleanInput) || cleanInput.length === 0) {
    return {
      isValid: false,
      input: digits48,
      cleanInput,
      is48Digits: false,
      is49Digits: false,
      computedCheckDigit: -1,
      fullAccessKey: cleanInput,
      sum: 0,
      remainder: 0,
      breakdown: [],
      errorMessage: 'La entrada solo debe contener dígitos numéricos.',
    };
  }

  // Validate length
  if (cleanInput.length !== 48) {
    return {
      isValid: false,
      input: digits48,
      cleanInput,
      is48Digits: false,
      is49Digits: cleanInput.length === 49,
      computedCheckDigit: -1,
      fullAccessKey: cleanInput,
      sum: 0,
      remainder: 0,
      breakdown: [],
      errorMessage: `La base debe tener exactamente 48 dígitos numéricos (actual: ${cleanInput.length}).`,
    };
  }

  const digits = cleanInput.split('').map(Number);

  // Compute breakdown: weights 2..7 from right to left
  const breakdown: Modulo11BreakdownRow[] = [];
  let sum = 0;

  for (let i = 0; i < digits.length; i++) {
    const reverseIndex = digits.length - 1 - i;
    const weight = WEIGHTS[reverseIndex % WEIGHTS.length];
    const digit = digits[i];
    const product = digit * weight;
    sum += product;
    breakdown.push({
      position: i + 1,
      digit,
      weight,
      product,
    });
  }

  const remainder = sum % 11;
  let computedCheckDigit: number;
  if (remainder === 0) {
    computedCheckDigit = 0;
  } else if (remainder === 1) {
    computedCheckDigit = 1;
  } else {
    const rawDv = 11 - remainder;
    computedCheckDigit = rawDv === 11 ? 0 : rawDv === 10 ? 1 : rawDv;
  }

  return {
    isValid: true,
    input: digits48,
    cleanInput,
    is48Digits: true,
    is49Digits: false,
    computedCheckDigit,
    fullAccessKey: `${cleanInput}${computedCheckDigit}`,
    sum,
    remainder,
    breakdown,
  };
}

export function verifyModulo11(digits49: string): Modulo11CalculationResult {
  const cleanInput = (digits49 || '').trim();
  if (cleanInput.length !== 49 || !/^\d{49}$/.test(cleanInput)) {
    return {
      isValid: false,
      input: digits49,
      cleanInput,
      is48Digits: cleanInput.length === 48,
      is49Digits: cleanInput.length === 49,
      computedCheckDigit: -1,
      fullAccessKey: cleanInput,
      sum: 0,
      remainder: 0,
      breakdown: [],
      errorMessage: 'La clave de acceso debe contener exactamente 49 dígitos numéricos.',
    };
  }

  const base48 = cleanInput.slice(0, 48);
  const providedCheckDigit = Number(cleanInput.slice(48, 49));
  const calc = calculateModulo11(base48);

  const isValid = calc.computedCheckDigit === providedCheckDigit;

  return {
    ...calc,
    input: digits49,
    cleanInput,
    is48Digits: false,
    is49Digits: true,
    providedCheckDigit,
    isValid,
    fullAccessKey: cleanInput,
    errorMessage: isValid
      ? undefined
      : `Dígito verificador inválido: se esperaba ${calc.computedCheckDigit}, pero se obtuvo ${providedCheckDigit}.`,
  };
}

/**
 * Generates a synthetic, mathematically valid 49-digit test SRI access key.
 */
export function generateTestAccessKey(): string {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = String(now.getFullYear());
  const fecha = `${dd}${mm}${yyyy}`;

  const tipoComprobante = '01';
  const ruc = '1792146739001';
  const ambiente = '1';
  const estab = '001';
  const ptoEmi = '001';
  const secuencial = '000000001';
  const random8 = String(Math.floor(10000000 + Math.random() * 90000000));
  const tipoEmision = '1';

  const base48 = `${fecha}${tipoComprobante}${ruc}${ambiente}${estab}${ptoEmi}${secuencial}${random8}${tipoEmision}`;
  const calc = calculateModulo11(base48);

  return `${base48}${calc.computedCheckDigit}`;
}
