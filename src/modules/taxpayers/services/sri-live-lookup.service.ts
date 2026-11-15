import { Inject, Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../../common/redis/redis.constants';
import {
  SRI_LIVE_CIRCUIT_COOLDOWN_SECONDS,
  SRI_LIVE_CIRCUIT_OPEN_KEY,
  SRI_LIVE_FAILURE_KEY,
  SRI_LIVE_FAILURE_THRESHOLD,
  SRI_LIVE_FAILURE_WINDOW_SECONDS,
  SRI_LIVE_TIMEOUT_MS,
} from '../taxpayers.constants';
import { assertSafeSriUrl } from '../utils/sri-ssrf-guard.util';

export interface SriLiveTaxpayerData {
  ruc: string;
  razonSocial: string;
  nombreComercial: string | null;
  tipoContribuyente: string | null;
  estadoContribuyente: string | null;
  obligadoContabilidad: boolean;
  actividadEconomica: string | null;
  direccionMatriz: string | null;
  regimenTributario?: 'GENERAL' | 'RIMPE_EMPRENDEDOR' | 'RIMPE_NEGOCIO_POPULAR';
}

const DEFAULT_SRI_LOOKUP_URL =
  'https://srienlinea.sri.gob.ec/sri-catastro-sujeto-servicio-internet/rest/ConsolidadoContribuyente/obtenerPorNumerosRuc';

@Injectable()
export class SriLiveLookupService {
  private readonly logger = new Logger(SriLiveLookupService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async lookupByRuc(
    ruc: string,
  ): Promise<{ data: SriLiveTaxpayerData | null; circuitOpen: boolean }> {
    if (await this.isCircuitOpen()) {
      return { data: null, circuitOpen: true };
    }

    const baseUrl = process.env.SRI_TAXPAYER_LOOKUP_URL || DEFAULT_SRI_LOOKUP_URL;
    const url = `${baseUrl}?ruc=${encodeURIComponent(ruc)}`;
    assertSafeSriUrl(url);

    try {
      const response = await axios.get<unknown>(url, {
        timeout: SRI_LIVE_TIMEOUT_MS,
        maxRedirects: 0,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'sri-invoice-gateway/1.0',
        },
      });

      if (this.isWafBlockedPayload(response.data)) {
        this.logger.warn(`SRI WAF HTML block detected for ${ruc}; opening circuit breaker`);
        await this.openCircuit();
        return { data: null, circuitOpen: true };
      }

      const parsed = this.parseSriPayload(ruc, response.data);
      return { data: parsed, circuitOpen: false };
    } catch (error: unknown) {
      const status = this.extractHttpStatus(error);
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`SRI live lookup failed for ${ruc} (status=${status ?? 'none'}): ${msg}`);

      if (status === 403 || status === 429) {
        await this.openCircuit();
        return { data: null, circuitOpen: true };
      }

      const tripped = await this.recordTransientFailure();
      return { data: null, circuitOpen: tripped };
    }
  }

  private async isCircuitOpen(): Promise<boolean> {
    try {
      return (await this.redis.get(SRI_LIVE_CIRCUIT_OPEN_KEY)) === '1';
    } catch {
      return false;
    }
  }

  private async openCircuit(): Promise<void> {
    try {
      await this.redis.set(SRI_LIVE_CIRCUIT_OPEN_KEY, '1', 'EX', SRI_LIVE_CIRCUIT_COOLDOWN_SECONDS);
    } catch (err: unknown) {
      this.logger.warn(`Failed opening SRI circuit key: ${(err as Error)?.message}`);
    }
  }

  private async recordTransientFailure(): Promise<boolean> {
    try {
      const count = await this.redis.incr(SRI_LIVE_FAILURE_KEY);
      if (count === 1) {
        await this.redis.expire(SRI_LIVE_FAILURE_KEY, SRI_LIVE_FAILURE_WINDOW_SECONDS);
      }
      if (count >= SRI_LIVE_FAILURE_THRESHOLD) {
        await this.openCircuit();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  private isWafBlockedPayload(payload: unknown): boolean {
    if (typeof payload !== 'string') return false;
    return /request rejected|<html|captcha|access denied/i.test(payload);
  }

  private extractHttpStatus(error: unknown): number | null {
    if (
      typeof error === 'object' &&
      error !== null &&
      'response' in error &&
      typeof (error as { response?: { status?: unknown } }).response?.status === 'number'
    ) {
      return (error as { response: { status: number } }).response.status;
    }
    return null;
  }

  private parseSriPayload(ruc: string, payload: unknown): SriLiveTaxpayerData | null {
    if (typeof payload === 'string') {
      return null;
    }

    const record = Array.isArray(payload) ? payload[0] : payload;
    if (!record || typeof record !== 'object') {
      return null;
    }

    const raw = record as Record<string, unknown>;
    const razonSocial = this.readString(raw.razonSocial);
    if (!razonSocial) {
      return null;
    }

    const obligadoRaw = raw.obligadoLlevarContabilidad ?? raw.obligadoContabilidad;
    const obligadoContabilidad =
      obligadoRaw === true || String(obligadoRaw || '').toUpperCase() === 'SI';

    const regimenRaw = String(raw.regimen ?? '').toUpperCase();
    let regimenTributario: SriLiveTaxpayerData['regimenTributario'] = 'GENERAL';
    if (regimenRaw.includes('POPULAR')) {
      regimenTributario = 'RIMPE_NEGOCIO_POPULAR';
    } else if (regimenRaw.includes('RIMPE')) {
      regimenTributario = 'RIMPE_EMPRENDEDOR';
    }

    return {
      ruc,
      razonSocial,
      nombreComercial: this.readString(raw.nombreComercial),
      tipoContribuyente: this.readString(raw.tipoContribuyente),
      estadoContribuyente:
        this.readString(raw.estadoContribuyenteRuc) ?? this.readString(raw.estadoContribuyente),
      obligadoContabilidad,
      actividadEconomica:
        this.readString(raw.actividadEconomicaPrincipal) ?? this.readString(raw.actividadEconomica),
      direccionMatriz: this.readString(raw.direccionMatriz),
      regimenTributario,
    };
  }

  private readString(val: unknown): string | null {
    if (typeof val !== 'string') return null;
    const trimmed = val.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
}
