import { BadRequestException } from '@nestjs/common';
import { SriRegimenType } from '@prisma/client';
import axios from 'axios';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('axios');
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { RucValidatorService } from '../../diagnostics/services/ruc-validator.service';
import { SriLiveLookupService } from '../services/sri-live-lookup.service';
import { TaxpayersService } from '../services/taxpayers.service';
import type { PrismaService } from '../../../prisma/prisma.service';

describe('TaxpayersService (TDD)', () => {
  let service: TaxpayersService;
  let rucValidator: RucValidatorService;
  let mockPrisma: {
    sriTaxpayerSpecial: { findUnique: ReturnType<typeof vi.fn> };
    sriTaxpayerProfile: { findUnique: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> };
  };
  let mockRedis: {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    del: ReturnType<typeof vi.fn>;
    incr: ReturnType<typeof vi.fn>;
    expire: ReturnType<typeof vi.fn>;
  };
  let mockLiveLookup: { lookupByRuc: ReturnType<typeof vi.fn> };
  let mockQueue: { add: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    rucValidator = new RucValidatorService();
    mockPrisma = {
      sriTaxpayerSpecial: { findUnique: vi.fn() },
      sriTaxpayerProfile: { findUnique: vi.fn(), upsert: vi.fn() },
    };
    mockRedis = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
      incr: vi.fn().mockResolvedValue(1),
      expire: vi.fn().mockResolvedValue(1),
    };
    mockLiveLookup = {
      lookupByRuc: vi.fn(),
    };
    mockQueue = {
      add: vi.fn().mockResolvedValue({ id: 'sync-job-1' }),
    };

    service = new TaxpayersService(
      mockPrisma as unknown as PrismaService,
      mockRedis as unknown as Redis,
      rucValidator,
      mockLiveLookup as unknown as SriLiveLookupService,
      mockQueue as unknown as Queue,
    );
  });

  // 3.10 RED — spec: sri-catastro-gateway/spec.md Scenario: Rechazo temprano por RUC matemáticamente inválido
  it('throws BadRequestException (INVALID_RUC) on invalid RUC before touching Redis, Postgres, or SRI live lookup', async () => {
    await expect(service.getTaxpayerByRuc('1790016918001')).rejects.toThrow(BadRequestException);

    try {
      await service.getTaxpayerByRuc('1790016918001');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).message).toContain('INVALID_RUC');
    }

    expect(mockRedis.get).not.toHaveBeenCalled();
    expect(mockPrisma.sriTaxpayerProfile.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.sriTaxpayerSpecial.findUnique).not.toHaveBeenCalled();
    expect(mockLiveLookup.lookupByRuc).not.toHaveBeenCalled();
  });

  // 3.13 RED — spec: sri-catastro-gateway/spec.md Scenario: Resolución híbrida con prioridad de catastro especial local sobre SRI online
  it('resolves Redis -> Postgres L2 + Special -> SriLiveLookup cascade prioritizing SriTaxpayerSpecial flags and populates caches', async () => {
    const ruc = '1790016919001';
    mockRedis.get.mockResolvedValueOnce(null);
    mockPrisma.sriTaxpayerProfile.findUnique.mockResolvedValueOnce(null);
    mockPrisma.sriTaxpayerSpecial.findUnique.mockResolvedValueOnce({
      ruc,
      razonSocial: 'CORPORACION FAVORITA C.A.',
      regimen: SriRegimenType.RIMPE_EMPRENDEDOR,
      isSpecialTaxpayer: true,
      specialTaxpayerRes: '5368',
      isWithholdingAgent: true,
      withholdingAgentRes: 'NAC-DNCRASC20-00000001',
      obligatedAccounting: null,
      taxpayerState: 'ACTIVO',
      inAgentsCatalog: true,
      inSpecialCatalog: true,
      inRimpeCatalog: true,
      updatedAt: new Date('2026-11-10T05:00:00Z'),
    });

    mockLiveLookup.lookupByRuc.mockResolvedValueOnce({
      circuitOpen: false,
      data: {
        ruc,
        razonSocial: 'CORPORACION FAVORITA C.A.',
        nombreComercial: 'SUPERMAXI',
        tipoContribuyente: 'SOCIEDADES',
        estadoContribuyente: 'ACTIVO',
        obligadoContabilidad: true,
        actividadEconomica: 'VENTA AL POR MENOR',
        direccionMatriz: 'AV. GENERAL ENRIQUEZ',
        regimenTributario: 'GENERAL', // Should be overridden by SriTaxpayerSpecial!
      },
    });

    const profile = await service.getTaxpayerByRuc(ruc);

    expect(profile).toMatchObject({
      ruc,
      rucValid: true,
      razonSocial: 'CORPORACION FAVORITA C.A.',
      nombreComercial: 'SUPERMAXI',
      tipoPersona: 'SOCIEDAD',
      obligadoContabilidad: true,
      esAgenteRetencion: true,
      resolucionAgenteRetencion: 'NAC-DNCRASC20-00000001',
      esContribuyenteEspecial: true,
      resolucionContribuyenteEspecial: '5368',
      regimenTributario: 'RIMPE_EMPRENDEDOR',
      source: 'SRI_LIVE',
      degraded: false,
      stale: false,
    });

    expect(mockPrisma.sriTaxpayerProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ruc },
        create: expect.objectContaining({
          ruc,
          isWithholdingAgent: true,
          isSpecialTaxpayer: true,
          regimen: SriRegimenType.RIMPE_EMPRENDEDOR,
        }),
      }),
    );
    expect(mockRedis.set).toHaveBeenCalledWith(
      `sri:taxpayer:${ruc}`,
      expect.any(String),
      'EX',
      expect.any(Number),
    );
  });

  // 3.16 RED — spec: sri-catastro-gateway/spec.md Scenario: Degradación segura ante bloqueo WAF de srienlinea
  it('opens Redis circuit breaker (15m cooldown) on WAF HTML/403/429 or timeout and returns degraded profile with SYNTAX_ONLY or LOCAL_CATALOG_ONLY', async () => {
    const realLiveLookup = new SriLiveLookupService(mockRedis as unknown as Redis);
    const serviceWithRealLive = new TaxpayersService(
      mockPrisma as unknown as PrismaService,
      mockRedis as unknown as Redis,
      rucValidator,
      realLiveLookup,
      mockQueue as unknown as Queue,
    );

    const rucNatural = '1710034065001'; // Valid Modulo 10 natural RUC
    mockRedis.get.mockResolvedValue(null);
    mockPrisma.sriTaxpayerProfile.findUnique.mockResolvedValue(null);
    mockPrisma.sriTaxpayerSpecial.findUnique.mockResolvedValueOnce(null);

    // WAF HTML response (Request Rejected)
    vi.mocked(axios.get).mockResolvedValueOnce({
      status: 200,
      data: '<html><head><title>Request Rejected</title></head><body>The requested URL was rejected.</body></html>',
    });

    const syntaxFallback = await serviceWithRealLive.getTaxpayerByRuc(rucNatural);

    expect(syntaxFallback).toMatchObject({
      ruc: rucNatural,
      rucValid: true,
      tipoPersona: 'NATURAL',
      esAgenteRetencion: false,
      esContribuyenteEspecial: false,
      degraded: true,
      stale: true,
      source: 'SYNTAX_ONLY',
    });

    // Circuit breaker should have been opened in Redis for 15 minutes (900 seconds)
    expect(mockRedis.set).toHaveBeenCalledWith('sri:live:circuit_open', '1', 'EX', 900);

    // Subsequent call when circuit is open in Redis skips axios.get and returns LOCAL_CATALOG_ONLY when special exists
    vi.clearAllMocks();
    const rucSpecial = '1790016919001';
    mockRedis.get.mockImplementation(async (key: string) =>
      key === 'sri:live:circuit_open' ? '1' : null,
    );
    mockPrisma.sriTaxpayerProfile.findUnique.mockResolvedValueOnce(null);
    mockPrisma.sriTaxpayerSpecial.findUnique.mockResolvedValueOnce({
      ruc: rucSpecial,
      razonSocial: 'CORPORACION FAVORITA C.A.',
      regimen: SriRegimenType.GENERAL,
      isSpecialTaxpayer: true,
      specialTaxpayerRes: '5368',
      isWithholdingAgent: true,
      withholdingAgentRes: 'NAC-DNCRASC20-00000001',
      obligatedAccounting: true,
      taxpayerState: 'ACTIVO',
      inAgentsCatalog: true,
      inSpecialCatalog: true,
      inRimpeCatalog: false,
      updatedAt: new Date('2026-11-10T05:00:00Z'),
    });

    const localOnlyFallback = await serviceWithRealLive.getTaxpayerByRuc(rucSpecial);

    expect(axios.get).not.toHaveBeenCalled();
    expect(localOnlyFallback).toMatchObject({
      ruc: rucSpecial,
      rucValid: true,
      tipoPersona: 'SOCIEDAD',
      esAgenteRetencion: true,
      esContribuyenteEspecial: true,
      degraded: true,
      stale: true,
      source: 'LOCAL_CATALOG_ONLY',
    });
  });

  // 3.19 RED — spec: sri-catastro-gateway/spec.md Scenarios: Withholding Eligibility Matrix (4 rules)
  describe('evaluateWithholdingEligibility()', () => {
    const buyerRuc = '1790016919001';
    const sellerRuc = '1790011674001';

    it('evaluates Agent -> General with codDocSustento=01 as BUYER_WITHHOLDS (obligatorioRenta=true, obligatorioIva=true)', async () => {
      mockLiveLookup.lookupByRuc.mockResolvedValue({ data: null, circuitOpen: false });
      const res = await service.evaluateWithholdingEligibility({
        buyerRuc,
        sellerRuc,
        codDocSustento: '01',
        buyerProfileOverride: { esAgenteRetencion: true, esContribuyenteEspecial: false },
        sellerProfileOverride: { regimenTributario: 'GENERAL', esContribuyenteEspecial: false },
      });

      expect(res.whoWithholds).toBe('BUYER_WITHHOLDS');
      expect(res.obligatorioRenta).toBe(true);
      expect(res.obligatorioIva).toBe(true);
      expect(res.applyRetention).toBe(true);
      expect(res.buyerEligible).toBe(true);
      expect(res.motivoLegal).toContain('07');
    });

    it('evaluates Agent -> RIMPE_NEGOCIO_POPULAR with codDocSustento=02 as NEITHER (332 / 0%)', async () => {
      mockLiveLookup.lookupByRuc.mockResolvedValue({ data: null, circuitOpen: false });
      const res = await service.evaluateWithholdingEligibility({
        buyerRuc,
        sellerRuc: '1710034065001',
        codDocSustento: '02',
        buyerProfileOverride: { esAgenteRetencion: true },
        sellerProfileOverride: { regimenTributario: 'RIMPE_NEGOCIO_POPULAR' },
      });

      expect(res.whoWithholds).toBe('NEITHER');
      expect(res.obligatorioRenta).toBe(false);
      expect(res.obligatorioIva).toBe(false);
      expect(res.sellerIsRimpePopular).toBe(true);
      expect(res.motivoLegal).toContain('332');
    });

    it('evaluates Non-Agent on Liquidacion de Compra (03) as BUYER_ON_LIQUIDACION (100% IVA + Renta)', async () => {
      mockLiveLookup.lookupByRuc.mockResolvedValue({ data: null, circuitOpen: false });
      const res = await service.evaluateWithholdingEligibility({
        buyerRuc,
        sellerRuc,
        codDocSustento: '03',
        buyerProfileOverride: { esAgenteRetencion: false, esContribuyenteEspecial: false },
        sellerProfileOverride: { regimenTributario: 'GENERAL' },
      });

      expect(res.whoWithholds).toBe('BUYER_ON_LIQUIDACION');
      expect(res.obligatorioRenta).toBe(true);
      expect(res.obligatorioIva).toBe(true);
      expect(res.applyRetention).toBe(true);
    });

    it('evaluates Non-Agent on Factura (01) as NEITHER (obligatorioRenta=false, obligatorioIva=false)', async () => {
      mockLiveLookup.lookupByRuc.mockResolvedValue({ data: null, circuitOpen: false });
      const res = await service.evaluateWithholdingEligibility({
        buyerRuc,
        sellerRuc,
        codDocSustento: '01',
        buyerProfileOverride: { esAgenteRetencion: false, esContribuyenteEspecial: false },
        sellerProfileOverride: { regimenTributario: 'GENERAL' },
      });

      expect(res.whoWithholds).toBe('NEITHER');
      expect(res.obligatorioRenta).toBe(false);
      expect(res.obligatorioIva).toBe(false);
      expect(res.applyRetention).toBe(false);
      expect(res.buyerEligible).toBe(false);
    });
  });

  // H-05 RED — spec: revoked flags in sriTaxpayerSpecial must not leak stale resolution numbers from dbProfile
  it('clears resolucionAgenteRetencion and resolucionContribuyenteEspecial when sriTaxpayerSpecial revokes flags even if dbProfile has old values', async () => {
    const ruc = '1790016919001';
    mockRedis.get.mockResolvedValueOnce(null);
    mockPrisma.sriTaxpayerProfile.findUnique.mockResolvedValueOnce({
      ruc,
      razonSocial: 'CORPORACION FAVORITA C.A.',
      nombreComercial: 'SUPERMAXI',
      tipoPersona: 'SOCIEDAD',
      regimen: SriRegimenType.GENERAL,
      obligatedAccounting: true,
      isSpecialTaxpayer: true,
      specialTaxpayerRes: 'CE-OLD-999',
      isWithholdingAgent: true,
      withholdingAgentRes: 'AG-OLD-888',
      taxpayerState: 'ACTIVO',
      actividadEconomica: 'COMERCIO',
      direccionMatriz: 'QUITO',
      source: 'SRI_LIVE',
      fetchedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      updatedAt: new Date(),
    });
    mockPrisma.sriTaxpayerSpecial.findUnique.mockResolvedValueOnce({
      ruc,
      razonSocial: 'CORPORACION FAVORITA C.A.',
      regimen: SriRegimenType.GENERAL,
      isSpecialTaxpayer: false,
      specialTaxpayerRes: null,
      isWithholdingAgent: false,
      withholdingAgentRes: null,
      obligatedAccounting: null,
      taxpayerState: 'ACTIVO',
      inAgentsCatalog: false,
      inSpecialCatalog: false,
      inRimpeCatalog: false,
      updatedAt: new Date(),
    });

    const profile = await service.getTaxpayerByRuc(ruc);

    expect(profile.esAgenteRetencion).toBe(false);
    expect(profile.resolucionAgenteRetencion).toBeNull();
    expect(profile.esContribuyenteEspecial).toBe(false);
    expect(profile.resolucionContribuyenteEspecial).toBeNull();
  });

  describe('evaluateWithholdingEligibility() extended SRI rules', () => {
    const setupProfiles = (
      buyerTipo: string | null = 'SOCIEDADES',
      buyerObligado = true,
      sellerRegimen: SriRegimenType = SriRegimenType.GENERAL,
    ) => {
      mockRedis.get.mockResolvedValue(null);
      mockPrisma.sriTaxpayerSpecial.findUnique.mockResolvedValue(null);
      mockPrisma.sriTaxpayerProfile.findUnique
        .mockResolvedValueOnce({
          ruc: '1790016919001',
          razonSocial: 'COMPRADOR S.A.',
          nombreComercial: null,
          tipoPersona: 'SOCIEDAD',
          tipoContribuyente: buyerTipo,
          regimen: SriRegimenType.GENERAL,
          obligatedAccounting: buyerObligado,
          isSpecialTaxpayer: false,
          specialTaxpayerRes: null,
          isWithholdingAgent: false,
          withholdingAgentRes: null,
          taxpayerState: 'ACTIVO',
          actividadEconomica: null,
          direccionMatriz: null,
          updatedAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
        })
        .mockResolvedValueOnce({
          ruc: '1790011674001',
          razonSocial: 'VENDEDOR S.A.',
          nombreComercial: null,
          tipoPersona: 'SOCIEDAD',
          tipoContribuyente: 'SOCIEDADES',
          regimen: sellerRegimen,
          obligatedAccounting: true,
          isSpecialTaxpayer: false,
          specialTaxpayerRes: null,
          isWithholdingAgent: false,
          withholdingAgentRes: null,
          taxpayerState: 'ACTIVO',
          actividadEconomica: null,
          direccionMatriz: null,
          updatedAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
        });
    };

    it('applies withholding on PAGO_EXTERIOR when buyer is obligadoContabilidad=true even without agent status', async () => {
      setupProfiles('SOCIEDADES', true);
      const res = await service.evaluateWithholdingEligibility({
        buyerRuc: '1790016919001',
        sellerRuc: '1790011674001',
        tipoOperacion: 'PAGO_EXTERIOR',
      });
      expect(res.applyRetention).toBe(true);
      expect(res.reasonCode).toBe('OBLIGADO_PAGO_EXTERIOR');
      expect(res.obligatorioRenta).toBe(true);
    });

    it('applies only 100% IVA for Exportador Habitual without Agente de Retención de Renta', async () => {
      setupProfiles('SOCIEDADES', true);
      const res = await service.evaluateWithholdingEligibility({
        buyerRuc: '1790016919001',
        sellerRuc: '1790011674001',
        buyerProfileOverride: { esExportadorHabitual: true },
      });
      expect(res.applyRetention).toBe(true);
      expect(res.reasonCode).toBe('EXPORTADOR_HABITUAL_IVA_ONLY');
      expect(res.obligatorioRenta).toBe(false);
      expect(res.obligatorioIva).toBe(true);
    });

    it('detects Sector Público from tipoContribuyente and enables withholding', async () => {
      setupProfiles('ENTIDAD DEL SECTOR PUBLICO', true);
      const res = await service.evaluateWithholdingEligibility({
        buyerRuc: '1790016919001',
        sellerRuc: '1790011674001',
      });
      expect(res.buyer.esSectorPublico).toBe(true);
      expect(res.applyRetention).toBe(true);
      expect(res.reasonCode).toBe('BUYER_AGENT_WITHHOLDS');
    });
  });

  // M-01 RED — BullMQ deterministic jobId deduplication, stale job cleanup, and anti-abuse cooldown
  describe('triggerSync() deduplication & cooldown', () => {
    it('uses deterministic jobId and removeOnComplete: true, and deduplicates when an active/waiting job exists', async () => {
      const mockGetJob = vi
        .fn()
        .mockResolvedValueOnce(null) // no ALL active
        .mockResolvedValueOnce(null); // no AGENTS active
      mockQueue = {
        add: vi.fn().mockResolvedValue({ id: 'sync-sri-catalogs-AGENTS' }),
        getJob: mockGetJob,
      } as unknown as typeof mockQueue;

      service = new TaxpayersService(
        mockPrisma as unknown as PrismaService,
        mockRedis as unknown as Redis,
        rucValidator,
        mockLiveLookup as unknown as SriLiveLookupService,
        mockQueue as unknown as Queue,
      );

      const first = await service.triggerSync({ source: 'AGENTS', force: false });
      expect(first).toMatchObject({
        success: true,
        queued: true,
        jobId: 'sync-sri-catalogs-AGENTS',
        source: 'AGENTS',
      });
      expect(mockQueue.add).toHaveBeenCalledWith(
        'sync-sri-catalogs',
        { source: 'AGENTS', force: false },
        expect.objectContaining({
          jobId: 'sync-sri-catalogs-AGENTS',
          removeOnComplete: true,
        }),
      );

      // Concurrent duplicate while AGENTS is active
      mockGetJob.mockReset();
      mockGetJob.mockResolvedValueOnce(null).mockResolvedValueOnce({
        id: 'sync-sri-catalogs-AGENTS',
        getState: vi.fn().mockResolvedValue('active'),
      });
      (mockQueue.add as ReturnType<typeof vi.fn>).mockClear();

      const dup = await service.triggerSync({ source: 'AGENTS', force: false });
      expect(dup).toMatchObject({
        success: true,
        queued: false,
        deduplicated: true,
        jobId: 'sync-sri-catalogs-AGENTS',
        source: 'AGENTS',
      });
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('removes leftover completed/failed job with deterministic jobId before enqueuing a fresh sync', async () => {
      const removeFn = vi.fn().mockResolvedValue(undefined);
      const mockGetJob = vi.fn().mockResolvedValue({
        id: 'sync-sri-catalogs-ALL',
        getState: vi.fn().mockResolvedValue('failed'),
        remove: removeFn,
      });
      mockQueue = {
        add: vi.fn().mockResolvedValue({ id: 'sync-sri-catalogs-ALL' }),
        getJob: mockGetJob,
      } as unknown as typeof mockQueue;

      service = new TaxpayersService(
        mockPrisma as unknown as PrismaService,
        mockRedis as unknown as Redis,
        rucValidator,
        mockLiveLookup as unknown as SriLiveLookupService,
        mockQueue as unknown as Queue,
      );

      const res = await service.triggerSync({ source: 'ALL', force: false });
      expect(removeFn).toHaveBeenCalledTimes(1);
      expect(res.queued).toBe(true);
      expect(mockQueue.add).toHaveBeenCalledTimes(1);
    });

    it('enforces server-side cooldown (429) for non-internal callers even with force: true, and allows internal/admin bypass with force: true', async () => {
      const mockGetJob = vi.fn().mockResolvedValue(null);
      mockQueue = {
        add: vi.fn().mockResolvedValue({ id: 'sync-sri-catalogs-ALL' }),
        getJob: mockGetJob,
      } as unknown as typeof mockQueue;

      service = new TaxpayersService(
        mockPrisma as unknown as PrismaService,
        mockRedis as unknown as Redis,
        rucValidator,
        mockLiveLookup as unknown as SriLiveLookupService,
        mockQueue as unknown as Queue,
      );

      // Cooldown key already exists in Redis -> SET NX returns null
      mockRedis.set.mockResolvedValueOnce(null);

      await expect(
        service.triggerSync({ source: 'ALL', force: true }, { isInternalAdmin: false }),
      ).rejects.toMatchObject({ status: 429 });
      expect(mockQueue.add).not.toHaveBeenCalled();

      // Internal/admin caller with force: true bypasses cooldown
      const adminRes = await service.triggerSync(
        { source: 'ALL', force: true },
        { isInternalAdmin: true },
      );
      expect(adminRes.queued).toBe(true);
      expect(mockQueue.add).toHaveBeenCalledTimes(1);
    });
  });
});
