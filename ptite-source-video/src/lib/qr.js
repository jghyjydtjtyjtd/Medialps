'use strict';

const QRCode = require('qrcode');

// Contraste élevé (foncé sur clair) : indispensable pour une lecture fiable par les téléphones.
const COLORS = { dark: '#050807ff', light: '#ffffffff' };

function clampSize(size) {
  const n = Number(size);
  if (!Number.isFinite(n)) return 512;
  return Math.min(2048, Math.max(128, Math.round(n)));
}

async function qrPng(text, size = 512) {
  return QRCode.toBuffer(text, {
    type: 'png',
    width: clampSize(size),
    margin: 2,
    errorCorrectionLevel: 'M',
    color: COLORS,
  });
}

async function qrSvg(text) {
  return QRCode.toString(text, {
    type: 'svg',
    margin: 2,
    errorCorrectionLevel: 'M',
    color: COLORS,
  });
}

module.exports = { qrPng, qrSvg, clampSize };
