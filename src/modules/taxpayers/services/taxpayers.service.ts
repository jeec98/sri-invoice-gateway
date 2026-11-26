import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { SriRegimenType, SriTaxpayerSpecial } from '@prisma/client';
import { Job, Queue } from 'bullmq';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../../common/redis/redis.constants';
import { PrismaService } from '../../../prisma/prisma.service';
import { RucType } from '../../diagnostics/constants/diagnostic-error-codes';
import { RucDiagnosticDto } from '../../diagnostics/dto/diagnostic-response.dto';
import { RucValidatorService } from '../../diagnostics/services/ruc-validator.service';
import {
  SRI_CATASTRO_QUEUE,
  SRI_CATASTRO_SYNC_COOLDOWN_KEY_PREFIX,
  SRI_CATASTRO_SYNC_COOLDOWN_SECONDS,
  SRI_DB_PROFILE_TTL_MS,
  SRI_TAXPAYER_CACHE_PREFIX,
  SRI_TAXPAYER_CACHE_TTL_SECONDS,
  SYNC_CATALOGS_JOB,
} from '../taxpayers.constants';
import {
  TaxpayerProfileOverrideDto,
  TaxpayerProfileResponseDto,
  TaxpayerRegimenTributario,
  TaxpayerTipoPersona,
  TipoOperacionRetencion,
  TriggerSyncDto,
  TriggerSyncResponseDto,
  WhoWithholds,
  WithholdingEligibilityDto,
  WithholdingEligibilityResponseDto,
} from '../dto/taxpayer-profile.dto';
import { SriLiveLookupService, SriLiveTaxpayerData } from './sri-live-lookup.service';

interface EligibilityEvalContext {
  codDoc: string;
  tipoOperacion: TipoOperacionRetencion;
  buyer: TaxpayerProfileResponseDto;
  seller: TaxpayerProfileResponseDto;
  buyerEligible: boolean;
  buyerExportadorHabitual: boolean;
  sellerIsRimpePopular: boolean;
  bothSpecial: boolean;
  emitirCeroInformativa: boolean;
}

interface EligibilityRuleOutcome {
  whoWithholds: WhoWithholds;
  obligatorioRenta: boolean;
  obligatorioIva: boolean;
  aplicaRetencionIvaEntreEspeciales: boolean;
  motivoLegal: string;
  reglasAplicables: string[];
  buyerEligible: boolean;
  applyRetention: boolean;
  zeroInformativePolicy: boolean;
  reasonCode: string;
}

interface EligibilityDecisionRule {
  id: string;
  matches: (ctx: EligibilityEvalContext) => boolean;
  resolve: (ctx: EligibilityEvalContext) => EligibilityRuleOutcome;
}

const WITHHOLDING_DECISION_RULES: readonly EligibilityDecisionRule[] = [
  {
    id: 'LIQUIDACION_COMPRA_03',
    matches: (ctx) => ctx.codDoc === '03' || ctx.tipoOperacion === 'LIQUIDACION_COMPRA',
    resolve: (ctx) => ({
      whoWithholds: 'BUYER_ON_LIQUIDACION',
      obligatorioRenta: true,
      obligatorioIva: true,
      aplicaRetencionIvaEntreEspeciales: false,
      motivoLegal:
        'Liquidación de Compra (codDocSustento=03): El comprador debe emitir comprobante de retención 07 aplicando Renta y 100% de IVA (código 3).',
      reglasAplicables: ['LIQUIDACION_COMPRA_03', 'IVA_100_COD_3'],
      buyerEligible: ctx.buyerEligible,
      applyRetention: true,
      zeroInformativePolicy: false,
      reasonCode: 'LIQUIDACION_COMPRA_03',
    }),
  },
  {
    id: 'OBLIGADO_PAGO_EXTERIOR',
    matches: (ctx) =>
      ctx.tipoOperacion === 'PAGO_EXTERIOR' &&
      Boolean(ctx.buyer.obligadoContabilidad || ctx.buyerEligible),
    resolve: (ctx) => ({
      whoWithholds: 'BUYER_WITHHOLDS',
      obligatorioRenta: true,
      obligatorioIva: true,
      aplicaRetencionIvaEntreEspeciales: false,
      motivoLegal:
        'Pago al exterior: Todo contribuyente obligado a llevar contabilidad (o agente de retención) debe retener Impuesto a la Renta e IVA en pagos o acreditaciones al exterior.',
      reglasAplicables: ['PAGO_EXTERIOR_OBLIGADO_CONTABILIDAD'],
      buyerEligible: true,
      applyRetention: true,
      zeroInformativePolicy: false,
      reasonCode: 'OBLIGADO_PAGO_EXTERIOR',
    }),
  },
  {
    id: 'OBLIGADO_DIVIDENDOS',
    matches: (ctx) =>
      ctx.tipoOperacion === 'DIVIDENDOS' &&
      Boolean(ctx.buyer.obligadoContabilidad || ctx.buyerEligible),
    resolve: () => ({
      whoWithholds: 'BUYER_WITHHOLDS',
      obligatorioRenta: true,
      obligatorioIva: false,
      aplicaRetencionIvaEntreEspeciales: false,
      motivoLegal:
        'Distribución de dividendos: Toda sociedad o contribuyente obligado a llevar contabilidad debe efectuar retención en la fuente de Impuesto a la Renta sobre dividendos.',
      reglasAplicables: ['DIVIDENDOS_OBLIGADO_CONTABILIDAD'],
      buyerEligible: true,
      applyRetention: true,
      zeroInformativePolicy: false,
      reasonCode: 'OBLIGADO_DIVIDENDOS',
    }),
  },
  {
    id: 'RIMPE_NEGOCIO_POPULAR_332',
    matches: (ctx) => ctx.sellerIsRimpePopular,
    resolve: (ctx) => ({
      whoWithholds: 'NEITHER',
      obligatorioRenta: false,
      obligatorioIva: false,
      aplicaRetencionIvaEntreEspeciales: false,
      motivoLegal:
        'Vendedor RIMPE Negocio Popular: exento de retención (código informativo 332 al 0% en Nota de Venta 02 / Factura 01).',
      reglasAplicables: ['RIMPE_NEGOCIO_POPULAR_COD_332_0PCT'],
      buyerEligible: ctx.buyerEligible,
      applyRetention: ctx.emitirCeroInformativa,
      zeroInformativePolicy: true,
      reasonCode: 'RIMPE_NEGOCIO_POPULAR_332',
    }),
  },
  {
    id: 'SECTORIAL_ESPECIAL',
    matches: (ctx) =>
      ctx.tipoOperacion === 'AGREGADOR_PAGO' ||
      ctx.tipoOperacion === 'EMISOR_TARJETA_SEGURO' ||
      (ctx.tipoOperacion === 'TURISMO_RECEPTIVO' &&
        !ctx.seller.esContribuyenteEspecial &&
        !ctx.seller.esAgenteRetencion),
    resolve: (ctx) => ({
      whoWithholds: 'BUYER_WITHHOLDS',
      obligatorioRenta: true,
      obligatorioIva: true,
      aplicaRetencionIvaEntreEspeciales: false,
      motivoLegal:
        'Operación sectorial sujeta a retención por ley (Turismo receptivo / Agregador de pago / Emisor de tarjeta o seguros).',
      reglasAplicables: [`SECTORIAL_${ctx.tipoOperacion}`],
      buyerEligible: true,
      applyRetention: true,
      zeroInformativePolicy: false,
      reasonCode: `SECTORIAL_${ctx.tipoOperacion}`,
    }),
  },
  {
    id: 'EXPORTADOR_HABITUAL_IVA_ONLY',
    matches: (ctx) =>
      !ctx.buyerEligible &&
      ctx.buyerExportadorHabitual &&
      ctx.buyer.regimenTributario !== 'RIMPE_NEGOCIO_POPULAR',
    resolve: () => ({
      whoWithholds: 'BUYER_WITHHOLDS',
      obligatorioRenta: false,
      obligatorioIva: true,
      aplicaRetencionIvaEntreEspeciales: false,
      motivoLegal:
        'Exportador Habitual (no designado Agente de Retención de Renta): debe retener 100% de IVA en adquisiciones destinadas a exportación.',
      reglasAplicables: ['EXPORTADOR_HABITUAL_IVA_100'],
      buyerEligible: true,
      applyRetention: true,
      zeroInformativePolicy: false,
      reasonCode: 'EXPORTADOR_HABITUAL_IVA_ONLY',
    }),
  },
  {
    id: 'BUYER_NOT_WITHHOLDING_AGENT',
    matches: (ctx) => !ctx.buyerEligible || ctx.buyer.regimenTributario === 'RIMPE_NEGOCIO_POPULAR',
    resolve: () => ({
      whoWithholds: 'NEITHER',
      obligatorioRenta: false,
      obligatorioIva: false,
      aplicaRetencionIvaEntreEspeciales: false,
      motivoLegal:
        'El comprador no tiene calificación de Agente de Retención, Contribuyente Especial, Sector Público ni Exportador Habitual para esta operación.',
      reglasAplicables: ['NO_AGENTE_NO_RETIENE'],
      buyerEligible: false,
      applyRetention: false,
      zeroInformativePolicy: false,
      reasonCode: 'BUYER_NOT_WITHHOLDING_AGENT',
    }),
  },
  {
    id: 'BUYER_AGENT_WITHHOLDS',
    matches: () => true,
    resolve: (ctx) => {
      const obligatorioIva = !(
        ctx.buyer.esAgenteRetencion &&
        !ctx.buyer.esContribuyenteEspecial &&
        !ctx.buyer.esSectorPublico &&
        ctx.seller.esContribuyenteEspecial
      );
      const reglasAplicables = [
        ctx.seller.regimenTributario === 'RIMPE_EMPRENDEDOR'
          ? 'RIMPE_EMPRENDEDOR_343_1PCT'
          : 'RENTA_GENERAL',
        ctx.bothSpecial
          ? 'IVA_ESPECIAL_10_20'
          : obligatorioIva
            ? 'IVA_30_70_100'
            : 'NO_RETIENE_IVA_A_ESPECIAL',
      ];
      return {
        whoWithholds: 'BUYER_WITHHOLDS',
        obligatorioRenta: true,
        obligatorioIva,
        aplicaRetencionIvaEntreEspeciales: ctx.bothSpecial,
        motivoLegal:
          'El comprador calificado (Agente de Retención / CE / Sector Público) debe emitir comprobante de retención 07 sobre esta compra.',
        reglasAplicables,
        buyerEligible: ctx.buyerEligible,
        applyRetention: true,
        zeroInformativePolicy: false,
        reasonCode: 'BUYER_AGENT_WITHHOLDS',
      };
    },
  },
];

@Injectable()
export class TaxpayersService {
  private readonly logger = new Logger(TaxpayersService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly rucValidator: RucValidatorService,
    private readonly sriLiveLookup: SriLiveLookupService,
    @InjectQueue(SRI_CATASTRO_QUEUE) private readonly catastroQueue: Queue,
  ) {}

  async getTaxpayerByRuc(ruc: string, refresh = false): Promise<TaxpayerProfileResponseDto> {
    const validation = this.validateAndNormalizeRuc(ruc);
    const cleanRuc = validation.ruc;
    const tipoPersona: TaxpayerTipoPersona =
      validation.type === RucType.PERSONA_NATURAL ? 'NATURAL' : 'SOCIEDAD';
    const cacheKey = `${SRI_TAXPAYER_CACHE_PREFIX}${cleanRuc}`;

    if (!refresh) {
      const cached = await this.readRedisCache(cacheKey);
      if (cached) {
        return { ...cached, source: 'REDIS_CACHE' };
      }
    }

    const [special, dbProfile] = await Promise.all([
      this.prisma.sriTaxpayerSpecial.findUnique({ where: { ruc: cleanRuc } }),
      refresh
        ? Promise.resolve(null)
        : this.prisma.sriTaxpayerProfile.findUnique({ where: { ruc: cleanRuc } }),
    ]);

    const now = new Date();
    if (dbProfile && dbProfile.expiresAt > now && !refresh) {
      const mergedFromDb = this.mergeSpecialAndLiveProfile({
        ruc: cleanRuc,
        tipoPersona,
        special,
        base: {
          razonSocial: dbProfile.razonSocial,
          nombreComercial: dbProfile.nombreComercial,
          tipoPersona: (dbProfile.tipoPersona as TaxpayerTipoPersona) || tipoPersona,
          regimen: dbProfile.regimen as TaxpayerRegimenTributario,
          obligatedAccounting: dbProfile.obligatedAccounting,
          isSpecialTaxpayer: dbProfile.isSpecialTaxpayer,
          specialTaxpayerRes: dbProfile.specialTaxpayerRes,
          isWithholdingAgent: dbProfile.isWithholdingAgent,
          withholdingAgentRes: dbProfile.withholdingAgentRes,
          esSectorPublico: this.inferSectorPublico(dbProfile.tipoContribuyente),
          taxpayerState: dbProfile.taxpayerState,
          actividadEconomica: dbProfile.actividadEconomica,
          direccionMatriz: dbProfile.direccionMatriz,
          updatedAt: dbProfile.updatedAt,
        },
        source: 'DB_PROFILE',
        degraded: false,
        stale: false,
      });
      await this.writeRedisCache(cacheKey, mergedFromDb);
      return mergedFromDb;
    }

    const liveResult = await this.sriLiveLookup.lookupByRuc(cleanRuc);
    if (liveResult.data) {
      const live = liveResult.data;
      const merged = this.mergeSpecialAndLiveProfile({
        ruc: cleanRuc,
        tipoPersona,
        special,
        base: {
          razonSocial: live.razonSocial,
          nombreComercial: live.nombreComercial,
          tipoPersona,
          regimen: live.regimenTributario ?? 'GENERAL',
          obligatedAccounting: live.obligadoContabilidad,
          isSpecialTaxpayer: false,
          specialTaxpayerRes: null,
          isWithholdingAgent: false,
          withholdingAgentRes: null,
          esSectorPublico: this.inferSectorPublico(live.tipoContribuyente),
          taxpayerState: live.estadoContribuyente ?? 'ACTIVO',
          actividadEconomica: live.actividadEconomica,
          direccionMatriz: live.direccionMatriz,
          updatedAt: now,
        },
        source: 'SRI_LIVE',
        degraded: false,
        stale: false,
      });
      await this.persistProfileAndCache(cleanRuc, cacheKey, merged, live, now);
      return merged;
    }

    const hasLocalCatalog = Boolean(special || dbProfile);
    const fallback = this.mergeSpecialAndLiveProfile({
      ruc: cleanRuc,
      tipoPersona,
      special,
      base: dbProfile
        ? {
            razonSocial: dbProfile.razonSocial,
            nombreComercial: dbProfile.nombreComercial,
            tipoPersona,
            regimen: dbProfile.regimen as TaxpayerRegimenTributario,
            obligatedAccounting: dbProfile.obligatedAccounting,
            isSpecialTaxpayer: dbProfile.isSpecialTaxpayer,
            specialTaxpayerRes: dbProfile.specialTaxpayerRes,
            isWithholdingAgent: dbProfile.isWithholdingAgent,
            withholdingAgentRes: dbProfile.withholdingAgentRes,
            esSectorPublico: this.inferSectorPublico(dbProfile.tipoContribuyente),
            taxpayerState: dbProfile.taxpayerState,
            actividadEconomica: dbProfile.actividadEconomica,
            direccionMatriz: dbProfile.direccionMatriz,
            updatedAt: dbProfile.updatedAt,
          }
        : null,
      source: hasLocalCatalog ? 'LOCAL_CATALOG_ONLY' : 'SYNTAX_ONLY',
      degraded: true,
      stale: true,
    });
    return fallback;
  }

  async evaluateWithholdingEligibility(
    dto: WithholdingEligibilityDto,
  ): Promise<WithholdingEligibilityResponseDto> {
    const [rawBuyer, rawSeller] = await Promise.all([
      this.getTaxpayerByRuc(dto.buyerRuc),
      this.getTaxpayerByRuc(dto.sellerRuc),
    ]);

    const buyer = this.applyProfileOverride(rawBuyer, dto.buyerProfileOverride);
    const seller = this.applyProfileOverride(rawSeller, dto.sellerProfileOverride);

    const ctx: EligibilityEvalContext = {
      codDoc: dto.codDocSustento || '01',
      tipoOperacion: dto.tipoOperacion || 'ESTANDAR',
      buyer,
      seller,
      buyerEligible: Boolean(
        buyer.esAgenteRetencion || buyer.esContribuyenteEspecial || buyer.esSectorPublico,
      ),
      buyerExportadorHabitual: Boolean(buyer.esExportadorHabitual),
      sellerIsRimpePopular: seller.regimenTributario === 'RIMPE_NEGOCIO_POPULAR',
      bothSpecial: Boolean(buyer.esContribuyenteEspecial && seller.esContribuyenteEspecial),
      emitirCeroInformativa: Boolean(dto.emitirCeroInformativa),
    };

    const matchedRule = WITHHOLDING_DECISION_RULES.find((rule) => rule.matches(ctx));
    const decision = matchedRule!.resolve(ctx);

    return {
      buyer,
      seller,
      whoWithholds: decision.whoWithholds,
      obligatorioRenta: decision.obligatorioRenta,
      obligatorioIva: decision.obligatorioIva,
      aplicaRetencionIvaEntreEspeciales: decision.aplicaRetencionIvaEntreEspeciales,
      motivoLegal: decision.motivoLegal,
      reglasAplicables: decision.reglasAplicables,
      buyerEligible: decision.buyerEligible,
      sellerIsRimpePopular: ctx.sellerIsRimpePopular,
      applyRetention: decision.applyRetention,
      zeroInformativePolicy: decision.zeroInformativePolicy,
      reasonCode: decision.reasonCode,
    };
  }

  private applyProfileOverride(
    profile: TaxpayerProfileResponseDto,
    override?: TaxpayerProfileOverrideDto,
  ): TaxpayerProfileResponseDto {
    if (!override) return profile;
    return {
      ...profile,
      ...(override.razonSocial !== undefined ? { razonSocial: override.razonSocial } : {}),
      ...(override.tipoPersona !== undefined ? { tipoPersona: override.tipoPersona } : {}),
      ...(override.regimenTributario !== undefined
        ? { regimenTributario: override.regimenTributario }
        : {}),
      ...(override.obligadoContabilidad !== undefined
        ? { obligadoContabilidad: override.obligadoContabilidad }
        : {}),
      ...(override.esContribuyenteEspecial !== undefined
        ? { esContribuyenteEspecial: override.esContribuyenteEspecial }
        : {}),
      ...(override.resolucionContribuyenteEspecial !== undefined
        ? { resolucionContribuyenteEspecial: override.resolucionContribuyenteEspecial }
        : {}),
      ...(override.esAgenteRetencion !== undefined
        ? { esAgenteRetencion: override.esAgenteRetencion }
        : {}),
      ...(override.resolucionAgenteRetencion !== undefined
        ? { resolucionAgenteRetencion: override.resolucionAgenteRetencion }
        : {}),
      ...(override.esSectorPublico !== undefined
        ? { esSectorPublico: override.esSectorPublico }
        : {}),
      ...(override.esExportadorHabitual !== undefined
        ? { esExportadorHabitual: override.esExportadorHabitual }
        : {}),
      ...(override.estadoContribuyente !== undefined
        ? { estadoContribuyente: override.estadoContribuyente }
        : {}),
    };
  }

  async triggerSync(
    dto?: TriggerSyncDto,
    options?: { isInternalAdmin?: boolean },
  ): Promise<TriggerSyncResponseDto> {
    const source = dto?.source ?? 'ALL';
    const requestedForce = Boolean(dto?.force);
    const isInternalAdmin = Boolean(options?.isInternalAdmin);
    const jobId = `${SYNC_CATALOGS_JOB}-${source}`;

    const activeDedup = await this.findAndCleanSyncJob(source, jobId);
    if (activeDedup) {
      return {
        success: true,
        queued: false,
        deduplicated: true,
        jobId: String(activeDedup.id ?? jobId),
        source,
      };
    }

    const bypassCooldown = isInternalAdmin && requestedForce;
    const cooldownKey = `${SRI_CATASTRO_SYNC_COOLDOWN_KEY_PREFIX}${source}`;
    let cooldownAcquired = false;

    if (!bypassCooldown) {
      cooldownAcquired = await this.tryAcquireSyncCooldown(cooldownKey);
      if (!cooldownAcquired) {
        throw new HttpException(
          `SYNC_COOLDOWN_ACTIVE: La sincronización para "${source}" está en cooldown (${SRI_CATASTRO_SYNC_COOLDOWN_SECONDS}s). Intente más tarde.`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    const effectiveForce = isInternalAdmin && requestedForce;
    try {
      const job = await this.catastroQueue.add(
        SYNC_CATALOGS_JOB,
        {
          source,
          force: effectiveForce,
        },
        {
          jobId,
          removeOnComplete: true,
          removeOnFail: 20,
        },
      );
      return {
        success: true,
        queued: true,
        deduplicated: false,
        jobId: String(job.id ?? jobId),
        source,
      };
    } catch (error) {
      if (cooldownAcquired) {
        await this.releaseSyncCooldown(cooldownKey);
      }
      throw error;
    }
  }

  private async findAndCleanSyncJob(source: string, jobId: string): Promise<Job | null> {
    if (typeof this.catastroQueue.getJob !== 'function') {
      return null;
    }

    const activeStates = new Set([
      'active',
      'waiting',
      'delayed',
      'prioritized',
      'waiting-children',
    ]);

    if (source !== 'ALL') {
      const allJob = await this.catastroQueue.getJob(`${SYNC_CATALOGS_JOB}-ALL`);
      if (allJob) {
        const allState = await allJob.getState();
        if (activeStates.has(allState)) {
          return allJob;
        }
      }
    }

    const existing = await this.catastroQueue.getJob(jobId);
    if (!existing) {
      return null;
    }

    const state = await existing.getState();
    if (activeStates.has(state)) {
      return existing;
    }

    // Remove leftover completed/failed job with the same deterministic jobId so new runs aren't blocked
    if (typeof existing.remove === 'function') {
      await existing.remove();
    }
    return null;
  }

  private async tryAcquireSyncCooldown(cooldownKey: string): Promise<boolean> {
    try {
      const acquired = await this.redis.set(
        cooldownKey,
        '1',
        'EX',
        SRI_CATASTRO_SYNC_COOLDOWN_SECONDS,
        'NX',
      );
      return acquired === 'OK';
    } catch (err: unknown) {
      this.logger.warn(
        `Redis sync cooldown check failed, failing open: ${(err as Error)?.message}`,
      );
      return true;
    }
  }

  private async releaseSyncCooldown(cooldownKey: string): Promise<void> {
    try {
      await this.redis.del(cooldownKey);
    } catch {
      // Ignore cleanup error
    }
  }

  private validateAndNormalizeRuc(ruc: string): RucDiagnosticDto {
    const cleanRuc = (ruc || '').trim();
    const validation = this.rucValidator.validate(cleanRuc);
    if (!validation.isValid) {
      const detail = validation.issues[0]?.message || 'RUC inválido según algoritmo Módulo 10/11.';
      throw new BadRequestException(`INVALID_RUC: ${detail}`);
    }
    return validation;
  }

  private async readRedisCache(cacheKey: string): Promise<TaxpayerProfileResponseDto | null> {
    try {
      const raw = await this.redis.get(cacheKey);
      if (!raw) return null;
      return JSON.parse(raw) as TaxpayerProfileResponseDto;
    } catch (err: unknown) {
      this.logger.warn(`Redis cache read error for ${cacheKey}: ${(err as Error)?.message}`);
      return null;
    }
  }

  private async writeRedisCache(
    cacheKey: string,
    profile: TaxpayerProfileResponseDto,
  ): Promise<void> {
    try {
      await this.redis.set(cacheKey, JSON.stringify(profile), 'EX', SRI_TAXPAYER_CACHE_TTL_SECONDS);
    } catch (err: unknown) {
      this.logger.warn(`Redis cache write error for ${cacheKey}: ${(err as Error)?.message}`);
    }
  }

  private mergeSpecialAndLiveProfile(params: {
    ruc: string;
    tipoPersona: TaxpayerTipoPersona;
    special: SriTaxpayerSpecial | null;
    base: {
      razonSocial: string | null;
      nombreComercial: string | null;
      tipoPersona: TaxpayerTipoPersona;
      regimen: TaxpayerRegimenTributario;
      obligatedAccounting: boolean;
      isSpecialTaxpayer: boolean;
      specialTaxpayerRes: string | null;
      isWithholdingAgent: boolean;
      withholdingAgentRes: string | null;
      esSectorPublico?: boolean;
      esExportadorHabitual?: boolean;
      taxpayerState: string | null;
      actividadEconomica: string | null;
      direccionMatriz: string | null;
      updatedAt: Date;
    } | null;
    source: TaxpayerProfileResponseDto['source'];
    stale: boolean;
    degraded: boolean;
  }): TaxpayerProfileResponseDto {
    const { ruc, tipoPersona, special, base, source, stale, degraded } = params;
    const specialOverridesRegimen = Boolean(
      special && (special.inRimpeCatalog || special.regimen !== SriRegimenType.GENERAL),
    );
    const regimenTributario: TaxpayerRegimenTributario = specialOverridesRegimen
      ? (special!.regimen as TaxpayerRegimenTributario)
      : ((base?.regimen ?? special?.regimen ?? 'GENERAL') as TaxpayerRegimenTributario);

    const esContribuyenteEspecial = special?.isSpecialTaxpayer ?? base?.isSpecialTaxpayer ?? false;
    const resolucionContribuyenteEspecial = special
      ? special.isSpecialTaxpayer
        ? (special.specialTaxpayerRes ?? base?.specialTaxpayerRes ?? null)
        : null
      : (base?.specialTaxpayerRes ?? null);

    const esAgenteRetencion = special?.isWithholdingAgent ?? base?.isWithholdingAgent ?? false;
    const resolucionAgenteRetencion = special
      ? special.isWithholdingAgent
        ? (special.withholdingAgentRes ?? base?.withholdingAgentRes ?? null)
        : null
      : (base?.withholdingAgentRes ?? null);

    return {
      ruc,
      rucValid: true,
      razonSocial: base?.razonSocial ?? special?.razonSocial ?? null,
      nombreComercial: base?.nombreComercial ?? null,
      tipoPersona: base?.tipoPersona ?? tipoPersona,
      regimenTributario,
      obligadoContabilidad: base?.obligatedAccounting ?? special?.obligatedAccounting ?? false,
      esContribuyenteEspecial,
      resolucionContribuyenteEspecial,
      esAgenteRetencion,
      resolucionAgenteRetencion,
      esSectorPublico: base?.esSectorPublico ?? false,
      esExportadorHabitual: base?.esExportadorHabitual ?? false,
      estadoContribuyente: base?.taxpayerState ?? special?.taxpayerState ?? null,
      actividadEconomica: base?.actividadEconomica ?? null,
      direccionMatriz: base?.direccionMatriz ?? null,
      source,
      stale,
      degraded,
      syncedAt: (special?.updatedAt ?? base?.updatedAt ?? null)?.toISOString() ?? null,
    };
  }

  private inferSectorPublico(tipoContribuyente?: string | null): boolean {
    if (!tipoContribuyente) return false;
    const norm = tipoContribuyente.toUpperCase();
    return (
      norm.includes('PUBLICO') ||
      norm.includes('PÚBLICO') ||
      norm.includes('PUBLICA') ||
      norm.includes('PÚBLICA') ||
      norm.includes('ESTADO')
    );
  }

  private async persistProfileAndCache(
    ruc: string,
    cacheKey: string,
    merged: TaxpayerProfileResponseDto,
    live: SriLiveTaxpayerData,
    now: Date,
  ): Promise<void> {
    const expiresAt = new Date(now.getTime() + SRI_DB_PROFILE_TTL_MS);
    const regimenEnum = merged.regimenTributario as SriRegimenType;

    await this.prisma.sriTaxpayerProfile.upsert({
      where: { ruc },
      create: {
        ruc,
        razonSocial: merged.razonSocial ?? ruc,
        nombreComercial: merged.nombreComercial,
        tipoPersona: merged.tipoPersona,
        tipoContribuyente: live.tipoContribuyente,
        regimen: regimenEnum,
        obligatedAccounting: merged.obligadoContabilidad,
        isSpecialTaxpayer: merged.esContribuyenteEspecial,
        specialTaxpayerRes: merged.resolucionContribuyenteEspecial,
        isWithholdingAgent: merged.esAgenteRetencion,
        withholdingAgentRes: merged.resolucionAgenteRetencion,
        taxpayerState: merged.estadoContribuyente ?? 'ACTIVO',
        actividadEconomica: merged.actividadEconomica,
        direccionMatriz: merged.direccionMatriz,
        source: 'SRI_LIVE',
        fetchedAt: now,
        expiresAt,
      },
      update: {
        razonSocial: merged.razonSocial ?? ruc,
        nombreComercial: merged.nombreComercial,
        tipoPersona: merged.tipoPersona,
        tipoContribuyente: live.tipoContribuyente,
        regimen: regimenEnum,
        obligatedAccounting: merged.obligadoContabilidad,
        isSpecialTaxpayer: merged.esContribuyenteEspecial,
        specialTaxpayerRes: merged.resolucionContribuyenteEspecial,
        isWithholdingAgent: merged.esAgenteRetencion,
        withholdingAgentRes: merged.resolucionAgenteRetencion,
        taxpayerState: merged.estadoContribuyente ?? 'ACTIVO',
        actividadEconomica: merged.actividadEconomica,
        direccionMatriz: merged.direccionMatriz,
        source: 'SRI_LIVE',
        fetchedAt: now,
        expiresAt,
      },
    });

    await this.writeRedisCache(cacheKey, merged);
  }
}
