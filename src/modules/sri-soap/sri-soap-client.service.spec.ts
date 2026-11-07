import { describe, it, expect, beforeEach } from 'vitest';
import { SriSoapClientService } from './sri-soap-client.service';

describe('SriSoapClientService', () => {
  let service: SriSoapClientService;

  beforeEach(() => {
    service = new SriSoapClientService();
  });

  it('should build valid SOAP 1.1 Envelopes for validarComprobante and autorizacionComprobante', () => {
    const recepcionEnvelope = service.buildRecepcionEnvelope('PGZhY3R1cmE+PC9mYWN0dXJhPg==');
    expect(recepcionEnvelope).toContain('<soapenv:Envelope');
    expect(recepcionEnvelope).toContain('http://ec.gob.sri.ws.recepcion');
    expect(recepcionEnvelope).toContain('<ec:validarComprobante>');
    expect(recepcionEnvelope).toContain('<xml>PGZhY3R1cmE+PC9mYWN0dXJhPg==</xml>');

    const authEnvelope = service.buildAutorizacionEnvelope(
      '0711202601179001167400110010010000001231234567815',
    );
    expect(authEnvelope).toContain('<soapenv:Envelope');
    expect(authEnvelope).toContain('http://ec.gob.sri.ws.autorizacion');
    expect(authEnvelope).toContain('<ec:autorizacionComprobante>');
    expect(authEnvelope).toContain(
      '<claveAccesoComprobante>0711202601179001167400110010010000001231234567815</claveAccesoComprobante>',
    );
  });

  it('should parse RECIBIDA and DEVUELTA SOAP responses from SRI Recepcion', () => {
    const recibidaSoapXml = `
      <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
        <soap:Body>
          <ns2:validarComprobanteResponse xmlns:ns2="http://ec.gob.sri.ws.recepcion">
            <RespuestaRecepcionComprobante>
              <estado>RECIBIDA</estado>
              <comprobantes/>
            </RespuestaRecepcionComprobante>
          </ns2:validarComprobanteResponse>
        </soap:Body>
      </soap:Envelope>
    `;

    const resRecibida = service.parseRecepcionResponse(recibidaSoapXml);
    expect(resRecibida.estado).toBe('RECIBIDA');
    expect(resRecibida.mensajes).toHaveLength(0);

    const devueltaSoapXml = `
      <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
        <soap:Body>
          <ns2:validarComprobanteResponse xmlns:ns2="http://ec.gob.sri.ws.recepcion">
            <RespuestaRecepcionComprobante>
              <estado>DEVUELTA</estado>
              <comprobantes>
                <comprobante>
                  <claveAcceso>0711202601179001167400110010010000001231234567815</claveAcceso>
                  <mensajes>
                    <mensaje>
                      <identificador>43</identificador>
                      <mensaje>CLAVE ACCESO REGISTRADA</mensaje>
                      <informacionAdicional>La clave de acceso ya se encuentra registrada</informacionAdicional>
                      <tipo>ERROR</tipo>
                    </mensaje>
                  </mensajes>
                </comprobante>
              </comprobantes>
            </RespuestaRecepcionComprobante>
          </ns2:validarComprobanteResponse>
        </soap:Body>
      </soap:Envelope>
    `;

    const resDevuelta = service.parseRecepcionResponse(devueltaSoapXml);
    expect(resDevuelta.estado).toBe('DEVUELTA');
    expect(resDevuelta.mensajes).toHaveLength(1);
    expect(resDevuelta.mensajes[0].identificador).toBe('43');
    expect(resDevuelta.mensajes[0].mensaje).toBe('CLAVE ACCESO REGISTRADA');
  });

  it('should parse AUTORIZADO and EN PROCESO SOAP responses from SRI Autorizacion', () => {
    const autorizadoSoapXml = `
      <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
        <soap:Body>
          <ns2:autorizacionComprobanteResponse xmlns:ns2="http://ec.gob.sri.ws.autorizacion">
            <RespuestaAutorizacionComprobante>
              <claveAccesoConsultada>0711202601179001167400110010010000001231234567815</claveAccesoConsultada>
              <numeroComprobantes>1</numeroComprobantes>
              <autorizaciones>
                <autorizacion>
                  <estado>AUTORIZADO</estado>
                  <numeroAutorizacion>0711202601179001167400110010010000001231234567815</numeroAutorizacion>
                  <fechaAutorizacion>2026-11-07T12:55:00-05:00</fechaAutorizacion>
                  <ambiente>PRUEBAS</ambiente>
                  <comprobante><![CDATA[<factura id="comprobante" version="1.1.0"></factura>]]></comprobante>
                  <mensajes/>
                </autorizacion>
              </autorizaciones>
            </RespuestaAutorizacionComprobante>
          </ns2:autorizacionComprobanteResponse>
        </soap:Body>
      </soap:Envelope>
    `;

    const parsedAuth = service.parseAutorizacionResponse(autorizadoSoapXml);
    expect(parsedAuth.estado).toBe('AUTORIZADO');
    expect(parsedAuth.numeroAutorizacion).toBe('0711202601179001167400110010010000001231234567815');
    expect(parsedAuth.authorizedXml).toContain('<autorizacion>');
    expect(parsedAuth.authorizedXml).toContain('<estado>AUTORIZADO</estado>');
  });
});
