import { defineConfig } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid';
import path from 'node:path';

const rawBase = process.env.DOCS_BASE_URL || '/';
const base = rawBase.endsWith('/') ? rawBase : `${rawBase}/`;

export default withMermaid(
  defineConfig({
    base,
    title: 'SRI Invoice Gateway Docs',
    description: 'Documentación técnica de alta concurrencia para facturación electrónica ecuatoriana SRI',
    lang: 'es-EC',
    cleanUrls: true,
    lastUpdated: true,
    head: [
      ['link', { rel: 'icon', href: `${base}logo.svg`, type: 'image/svg+xml' }],
      ['meta', { name: 'theme-color', content: '#2563eb' }],
    ],
    themeConfig: {
      logo: '/logo.svg',
      siteTitle: 'SRI Invoice Gateway Docs',
      nav: [
        { text: 'Registrar SaaS', link: '/guide/provisioning#formulario-de-registro' },
        { text: 'Guía Rápida', link: '/guide/quickstart' },
        { text: 'Arquitectura', link: '/guide/architecture' },
        { text: 'Herramientas', link: '/guide/modulo11' },
        { text: 'API Reference', link: '/api/endpoints' },
      ],
      sidebar: [
        {
          text: 'Guía Rápida & Arquitectura',
          items: [
            { text: 'Inicio Rápido (Quickstart)', link: '/guide/quickstart' },
            { text: 'Arquitectura 2-Tier B2B2B', link: '/guide/architecture' },
          ],
        },
        {
          text: 'Integración & Facturación',
          items: [
            { text: 'Provisionamiento SaaS', link: '/guide/provisioning' },
            { text: 'Gestión de Tenants', link: '/guide/tenants' },
            { text: 'Certificados Digitales .p12', link: '/guide/certificates' },
            { text: 'Emisión de Facturas (<200ms)', link: '/guide/invoices' },
            { text: 'Ciclo de Vida & Estados SRI', link: '/guide/statuses' },
            { text: 'Webhooks & HMAC-SHA256', link: '/guide/webhooks' },
            { text: 'Rate Limiting', link: '/guide/rate-limiting' },
          ],
        },
        {
          text: 'Herramientas Interactivas',
          items: [
            { text: 'Calculadora Módulo 11', link: '/guide/modulo11' },
          ],
        },
        {
          text: 'API Reference',
          items: [
            { text: 'Endpoints REST (v1)', link: '/api/endpoints' },
          ],
        },
      ],
      search: {
        provider: 'local',
        options: {
          locales: {
            root: {
              translations: {
                button: { buttonText: 'Buscar documentación', buttonAriaLabel: 'Buscar' },
                modal: {
                  displayDetails: 'Mostrar detalles',
                  resetButtonTitle: 'Borrar búsqueda',
                  backButtonTitle: 'Cerrar búsqueda',
                  noResultsText: 'No se encontraron resultados para',
                  footer: {
                    selectText: 'para seleccionar',
                    navigateText: 'para navegar',
                    closeText: 'para cerrar',
                  },
                },
              },
            },
          },
        },
      },
      socialLinks: [
        { icon: 'github', link: 'https://github.com/jeec98/sri-invoice-gateway' },
      ],
      footer: {
        message: 'Apache-2.0 License',
        copyright: 'Documentación Oficial SRI Facturación Electrónica',
      },
    },
    mermaid: {
      theme: 'default',
    },
    vite: {
      envDir: path.resolve(__dirname, '../..'),
    },
  })
);
